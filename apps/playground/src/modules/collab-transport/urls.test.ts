import { describe, expect, it, vi } from "vitest";
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
} from "./websocket-broadcast-channel";

describe("collab transport urls", () => {
  it("maps http(s) origins to ws(s)", () => {
    expect(toWebSocketOrigin("http://localhost:3000")).toBe(
      "ws://localhost:3000",
    );
    expect(toWebSocketOrigin("https://playground.example/")).toBe(
      "wss://playground.example",
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
  it("queues messages until the socket opens", () => {
    const listeners = new Map<string, Set<(event: Event) => void>>();
    let readyState = 0;
    const sent: string[] = [];

    const socket = {
      get readyState() {
        return readyState;
      },
      send: (data: string) => {
        sent.push(data);
      },
      close: vi.fn(),
      addEventListener: (type: string, listener: (event: Event) => void) => {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
    };

    const channel = createWebSocketBroadcastChannel({
      url: "ws://localhost:3000/api/collab-doc",
      roomId: "room-1",
      webSocketFactory: () => socket as unknown as WebSocket,
    });

    channel.postMessage({ type: "event", roomId: "room-1" });
    expect(sent).toEqual([]);

    readyState = 1;
    for (const listener of listeners.get("open") ?? []) {
      listener(new Event("open"));
    }
    expect(sent).toEqual([JSON.stringify({ type: "event", roomId: "room-1" })]);
    channel.close();
  });

  it("appends roomId to the websocket url", () => {
    expect(
      buildDocWebSocketUrl("ws://localhost:3000/api/collab-doc", "abc"),
    ).toBe("ws://localhost:3000/api/collab-doc?roomId=abc");
  });
});
