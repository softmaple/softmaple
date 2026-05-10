import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AdapterConnectionState,
  ConnectionCallback,
  ErrorCallback,
  EventCallback,
  PresenceAdapter,
  PresenceCallback,
  Unsubscribe,
} from "../adapters/types";
import { PRESENCE_EVENT } from "../constants/presence-events";
import type { PresenceUser } from "../types/presence";
import type { PresenceContextValue } from "./presence-context";
import { PresenceContext } from "./presence-context";
import { PresenceProvider } from "./presence-provider";

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

class MockPresenceAdapter implements PresenceAdapter {
  private readonly eventCallbacks = new Set<EventCallback>();

  connect = vi.fn(async (): Promise<void> => {});

  disconnect = vi.fn(async (): Promise<void> => {});

  getConnectionState = (): AdapterConnectionState => "connected";

  updatePresence = vi.fn();

  broadcast = vi.fn();

  onPresenceChange = (callback: PresenceCallback): Unsubscribe => {
    callback(new Map());
    return (): void => {};
  };

  onEvent = (callback: EventCallback): Unsubscribe => {
    this.eventCallbacks.add(callback);
    return (): void => {
      this.eventCallbacks.delete(callback);
    };
  };

  onConnectionChange = (callback: ConnectionCallback): Unsubscribe => {
    callback("connected");
    return (): void => {};
  };

  onError =
    (_callback: ErrorCallback): Unsubscribe =>
    (): void => {};

  getPresence = (): ReadonlyMap<string, PresenceUser> => new Map();

  getSelf = (): null => null;

  emitTyping = (isTyping: boolean): void => {
    for (const callback of this.eventCallbacks) {
      callback({
        type: PRESENCE_EVENT.UPDATE,
        payload: {
          type: PRESENCE_EVENT.UPDATE,
          userId: "remote-user",
          updates: { meta: { isTyping } },
        },
        timestamp: 123,
      });
    }
  };
}

class FullMockAdapter implements PresenceAdapter {
  presenceCallbacks = new Set<PresenceCallback>();
  eventCallbacks = new Set<EventCallback>();
  connectionCallbacks = new Set<ConnectionCallback>();
  errorCallbacks = new Set<ErrorCallback>();

  state: AdapterConnectionState = "disconnected";
  presence: ReadonlyMap<string, PresenceUser> = new Map();
  self: PresenceUser | null = null;

  connect = vi.fn(async (): Promise<void> => {
    this.state = "connected";
    for (const cb of this.connectionCallbacks) cb("connected");
  });

  disconnect = vi.fn(async (): Promise<void> => {
    this.state = "disconnected";
    for (const cb of this.connectionCallbacks) cb("disconnected");
  });

  getConnectionState = (): AdapterConnectionState => this.state;
  updatePresence = vi.fn();
  broadcast = vi.fn();
  getPresence = (): ReadonlyMap<string, PresenceUser> => this.presence;
  getSelf = (): PresenceUser | null => this.self;

  onPresenceChange = (callback: PresenceCallback): Unsubscribe => {
    this.presenceCallbacks.add(callback);
    return () => {
      this.presenceCallbacks.delete(callback);
    };
  };

  onEvent = (callback: EventCallback): Unsubscribe => {
    this.eventCallbacks.add(callback);
    return () => {
      this.eventCallbacks.delete(callback);
    };
  };

  onConnectionChange = (callback: ConnectionCallback): Unsubscribe => {
    this.connectionCallbacks.add(callback);
    return () => {
      this.connectionCallbacks.delete(callback);
    };
  };

  onError = (callback: ErrorCallback): Unsubscribe => {
    this.errorCallbacks.add(callback);
    return () => {
      this.errorCallbacks.delete(callback);
    };
  };

  emitConnected = (self: PresenceUser): void => {
    this.self = self;
    this.presence = new Map([[self.userId, self]]);
    this.state = "connected";
    for (const cb of this.connectionCallbacks) cb("connected");
    for (const cb of this.presenceCallbacks) cb(this.presence);
  };

  emitJoin = (user: PresenceUser): void => {
    this.presence = new Map(this.presence).set(user.userId, user);
    for (const cb of this.presenceCallbacks) cb(this.presence);
    for (const cb of this.eventCallbacks) {
      cb({
        type: PRESENCE_EVENT.JOIN,
        payload: { type: PRESENCE_EVENT.JOIN, user },
        timestamp: 100,
      });
    }
  };
}

describe("PresenceProvider", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("auto-connects on mount and disconnects on unmount", async () => {
    const adapter = new FullMockAdapter();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PresenceProvider adapter={adapter}>{null}</PresenceProvider>,
      );
    });
    expect(adapter.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    expect(adapter.disconnect).toHaveBeenCalledTimes(1);
  });

  it("skips auto-connect when autoConnect=false", async () => {
    const adapter = new FullMockAdapter();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PresenceProvider adapter={adapter} autoConnect={false}>
          {null}
        </PresenceProvider>,
      );
    });
    expect(adapter.connect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("logs but doesn't throw when adapter.connect rejects", async () => {
    const adapter = new FullMockAdapter();
    adapter.connect = vi.fn(async () => {
      throw new Error("boom");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PresenceProvider adapter={adapter}>{null}</PresenceProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to connect"),
      expect.any(Error),
    );

    await act(async () => {
      root.unmount();
    });
    consoleError.mockRestore();
  });

  it("updates self/presence/connectionState on adapter events", async () => {
    const adapter = new FullMockAdapter();
    const contextRef: { current: PresenceContextValue | null } = {
      current: null,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PresenceProvider adapter={adapter} autoConnect={false}>
          <PresenceContext.Consumer>
            {(value) => {
              contextRef.current = value;
              return null;
            }}
          </PresenceContext.Consumer>
        </PresenceProvider>,
      );
    });

    const self: PresenceUser = {
      userId: "self",
      name: "Self",
      color: "#000",
      status: "active",
      lastActiveAt: 0,
    };

    act(() => {
      adapter.emitConnected(self);
    });
    expect(contextRef.current?.connectionState).toBe("connected");
    expect(contextRef.current?.self?.userId).toBe("self");
    expect(contextRef.current?.presence.size).toBe(1);

    const peer: PresenceUser = {
      userId: "peer",
      name: "Peer",
      color: "#111",
      status: "active",
      lastActiveAt: 100,
    };
    act(() => {
      adapter.emitJoin(peer);
    });

    expect(contextRef.current?.others).toHaveLength(1);
    expect(contextRef.current?.recentActivity).toHaveLength(1);

    await act(async () => {
      await adapter.disconnect();
    });
    expect(contextRef.current?.connectionState).toBe("disconnected");
    expect(contextRef.current?.self).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("exposes connect/disconnect/updatePresence/adapter via context", async () => {
    const adapter = new FullMockAdapter();
    const contextRef: { current: PresenceContextValue | null } = {
      current: null,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PresenceProvider adapter={adapter} autoConnect={false}>
          <PresenceContext.Consumer>
            {(value) => {
              contextRef.current = value;
              return null;
            }}
          </PresenceContext.Consumer>
        </PresenceProvider>,
      );
    });

    await act(async () => {
      await contextRef.current?.connect();
    });
    expect(adapter.connect).toHaveBeenCalled();

    contextRef.current?.updatePresence({ meta: { isTyping: true } });
    expect(adapter.updatePresence).toHaveBeenCalledWith({
      meta: { isTyping: true },
    });

    await act(async () => {
      await contextRef.current?.disconnect();
    });
    expect(adapter.disconnect).toHaveBeenCalled();
    expect(contextRef.current?.adapter).toBe(adapter);

    await act(async () => {
      root.unmount();
    });
  });

  it("does not record stop-typing updates as typing activity", async () => {
    const adapter = new MockPresenceAdapter();
    const contextRef: { current: PresenceContextValue | null } = {
      current: null,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PresenceProvider adapter={adapter}>
          <PresenceContext.Consumer>
            {(value) => {
              contextRef.current = value;
              return null;
            }}
          </PresenceContext.Consumer>
        </PresenceProvider>,
      );
    });

    act(() => {
      adapter.emitTyping(false);
    });

    expect(contextRef.current?.recentActivity).toEqual([]);

    act(() => {
      adapter.emitTyping(true);
    });

    expect(contextRef.current?.recentActivity).toHaveLength(1);
    expect(contextRef.current?.recentActivity[0]?.data).toEqual({
      type: "typing",
      isTyping: true,
    });

    await act(async () => {
      root.unmount();
    });
  });
});
