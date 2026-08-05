import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSameOriginEndpoints,
  COLLAB_TRANSPORT,
  resolveBrowserCollabEndpoints,
  resolveCollabTransport,
  toWebSocketOrigin,
} from "./urls";
import {
  buildDocWebSocketUrl,
  createWebSocketBroadcastChannel,
} from "./websocketBroadcastChannel";

type FakeSocket = {
  readyState: number;
  send: (data: string) => void;
  readonly close: ReturnType<typeof vi.fn>;
  readonly addEventListener: (
    type: string,
    listener: (event: Event) => void,
  ) => void;
  setReadyState: (next: number) => void;
  dispatch: (type: string, event?: Event) => void;
};

const createFakeSocket = (): FakeSocket => {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  let readyState = 0;
  return {
    get readyState() {
      return readyState;
    },
    set readyState(next) {
      readyState = next;
    },
    setReadyState: (next) => {
      readyState = next;
    },
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    dispatch: (type, event = new Event(type)) => {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    },
  };
};

describe("collab transport urls", () => {
  it("maps http(s) origins to ws(s)", () => {
    expect(toWebSocketOrigin("http://localhost:3000")).toBe(
      "ws://localhost:3000",
    );
    expect(toWebSocketOrigin("https://playground.example/")).toBe(
      "wss://playground.example",
    );
    expect(toWebSocketOrigin("wss://secure.example/collab")).toBe(
      "wss://secure.example",
    );
  });

  it("prefers query transport over env default", () => {
    expect(
      resolveCollabTransport(
        "?transport=broadcast",
        COLLAB_TRANSPORT.WebSocket,
      ),
    ).toBe(COLLAB_TRANSPORT.Broadcast);
    expect(resolveCollabTransport("", COLLAB_TRANSPORT.Broadcast)).toBe(
      COLLAB_TRANSPORT.Broadcast,
    );
    expect(resolveCollabTransport("")).toBe(COLLAB_TRANSPORT.WebSocket);
  });

  it("builds same-origin websocket endpoints", () => {
    expect(
      buildSameOriginEndpoints(
        "http://localhost:3000",
        COLLAB_TRANSPORT.WebSocket,
      ),
    ).toEqual({
      transport: COLLAB_TRANSPORT.WebSocket,
      docWsUrl: "ws://localhost:3000/api/collab-doc",
      presenceWsUrl: "ws://localhost:3000/api/presence",
      syncWsUrl: "ws://localhost:3000/api/collab-sync",
    });
  });

  it("returns null endpoints for broadcast mode", () => {
    const endpoints = resolveBrowserCollabEndpoints({
      search: "?transport=broadcast",
      locationOrigin: "http://localhost:3000",
    });
    expect(endpoints.transport).toBe(COLLAB_TRANSPORT.Broadcast);
    expect(endpoints.docWsUrl).toBeNull();
  });
});

describe("websocket broadcast channel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues messages until the socket opens", () => {
    const socket = createFakeSocket();
    const sent: string[] = [];
    socket.send = (data: string) => {
      sent.push(data);
    };

    const channel = createWebSocketBroadcastChannel({
      url: "ws://localhost:3000/api/collab-doc",
      roomId: "room-1",
      webSocketFactory: () => socket as unknown as WebSocket,
    });

    channel.postMessage({ type: "event", roomId: "room-1" });
    expect(sent).toEqual([]);

    socket.setReadyState(1);
    socket.dispatch("open");
    expect(sent).toEqual([JSON.stringify({ type: "event", roomId: "room-1" })]);
    channel.close();
  });

  it("appends roomId to the websocket url", () => {
    expect(
      buildDocWebSocketUrl("ws://localhost:3000/api/collab-doc", "abc"),
    ).toBe("ws://localhost:3000/api/collab-doc?roomId=abc");
  });

  it("schedules reconnect after close and stops after channel.close", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];

    const channel = createWebSocketBroadcastChannel({
      url: "ws://localhost:3000/api/collab-doc",
      roomId: "room-1",
      reconnectDelayMs: 1_000,
      webSocketFactory: () => {
        const next = createFakeSocket();
        sockets.push(next);
        return next as unknown as WebSocket;
      },
    });

    expect(sockets).toHaveLength(1);
    sockets[0]?.dispatch("close");
    vi.advanceTimersByTime(2_000);
    expect(sockets.length).toBeGreaterThanOrEqual(2);

    const socketsAfterReconnect = sockets.length;
    channel.close();
    sockets[socketsAfterReconnect - 1]?.dispatch("close");
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(socketsAfterReconnect);
  });

  it("delivers parsed JSON to onmessage and ignores malformed frames", () => {
    const socket = createFakeSocket();
    const channel = createWebSocketBroadcastChannel({
      url: "ws://localhost:3000/api/collab-doc",
      roomId: "room-1",
      webSocketFactory: () => socket as unknown as WebSocket,
    });

    const received: unknown[] = [];
    channel.onmessage = (event) => {
      received.push(event.data);
    };

    socket.dispatch("message", {
      data: JSON.stringify({ type: "event", roomId: "room-1" }),
    } as MessageEvent);
    expect(received).toEqual([{ type: "event", roomId: "room-1" }]);

    expect(() => {
      socket.dispatch("message", { data: "not-json{" } as MessageEvent);
    }).not.toThrow();
    expect(received).toHaveLength(1);
    channel.close();
  });

  it("fires onopen and connection callbacks across reconnect", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const opens: number[] = [];
    const states: string[] = [];

    const channel = createWebSocketBroadcastChannel({
      url: "ws://localhost:3000/api/collab-doc",
      roomId: "room-1",
      reconnectDelayMs: 1_000,
      webSocketFactory: () => {
        const next = createFakeSocket();
        sockets.push(next);
        return next as unknown as WebSocket;
      },
    });

    channel.onconnectionchange = (state) => {
      states.push(state);
    };
    channel.onopen = () => {
      opens.push(opens.length);
    };

    sockets[0]?.setReadyState(1);
    sockets[0]?.dispatch("open");
    expect(opens).toHaveLength(1);
    expect(states.at(-1)).toBe("connected");

    sockets[0]?.dispatch("close");
    expect(states.at(-1)).toBe("reconnecting");

    vi.advanceTimersByTime(2_000);
    expect(sockets.length).toBeGreaterThanOrEqual(2);
    sockets[1]?.setReadyState(1);
    sockets[1]?.dispatch("open");
    expect(opens).toHaveLength(2);
    expect(states.at(-1)).toBe("connected");
    channel.close();
  });

  it("ignores late close events from replaced sockets", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];

    createWebSocketBroadcastChannel({
      url: "ws://localhost:3000/api/collab-doc",
      roomId: "room-1",
      reconnectDelayMs: 1_000,
      webSocketFactory: () => {
        const next = createFakeSocket();
        sockets.push(next);
        return next as unknown as WebSocket;
      },
    });

    const first = sockets[0];
    first?.dispatch("close");
    vi.advanceTimersByTime(2_000);
    expect(sockets.length).toBeGreaterThanOrEqual(2);

    const beforeLateClose = sockets.length;
    first?.dispatch("close");
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(beforeLateClose);
  });
});
