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
import { PRESENCE_EVENT } from "../types/events";
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

  emitPresence = (users: ReadonlyArray<PresenceUser>): void => {
    this.presence = new Map(users.map((user) => [user.userId, user]));
    for (const cb of this.presenceCallbacks) cb(this.presence);
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

  it("remaps remote positions locally without sending adapter updates", async () => {
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
      cursor: { blockId: "body", offset: 1 },
    };
    const peer: PresenceUser = {
      userId: "peer",
      name: "Peer",
      color: "#111",
      status: "active",
      lastActiveAt: 0,
      cursor: { blockId: "body", offset: 6 },
    };

    act(() => {
      adapter.self = self;
      adapter.emitPresence([self, peer]);
    });

    act(() => {
      contextRef.current?.remapRemotePositions({
        mapPosition: ({ blockId, offset }) => ({ blockId, offset: offset + 4 }),
      });
    });

    expect(contextRef.current?.presence.get("self")?.cursor).toEqual({
      blockId: "body",
      offset: 1,
    });
    expect(contextRef.current?.presence.get("peer")?.cursor).toEqual({
      blockId: "body",
      offset: 10,
    });
    expect(adapter.updatePresence).not.toHaveBeenCalled();
    expect(adapter.broadcast).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("applies resolver to peers exposed via others / presence", async () => {
    const adapter = new FullMockAdapter();
    const contextRef: { current: PresenceContextValue | null } = {
      current: null,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    const resolveCursor = vi.fn(() => ({ blockId: "body", offset: 42 }));
    const resolveSelection = vi.fn(() => ({
      blockId: "body",
      from: 10,
      to: 15,
    }));

    await act(async () => {
      root.render(
        <PresenceProvider
          adapter={adapter}
          autoConnect={false}
          resolver={{ resolveCursor, resolveSelection }}
        >
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
      cursor: { blockId: "body", offset: 1, anchor: "self-anchor" },
    };
    const peer: PresenceUser = {
      userId: "peer",
      name: "Peer",
      color: "#111",
      status: "active",
      lastActiveAt: 0,
      cursor: { blockId: "body", offset: 6, anchor: "cursor-anchor" },
      selection: {
        blockId: "body",
        from: 6,
        to: 11,
        fromAnchor: "from",
        toAnchor: "to",
      },
    };

    act(() => {
      adapter.self = self;
      adapter.emitPresence([self, peer]);
    });

    const resolvedPeer = contextRef.current?.others[0];
    expect(resolvedPeer?.userId).toBe("peer");
    expect(resolvedPeer?.cursor).toEqual({ blockId: "body", offset: 42 });
    expect(resolvedPeer?.selection).toEqual({
      blockId: "body",
      from: 10,
      to: 15,
    });

    // Self is broadcast, not resolved — the raw anchored cursor is preserved.
    expect(contextRef.current?.self?.cursor).toEqual({
      blockId: "body",
      offset: 1,
      anchor: "self-anchor",
    });
    // Resolver must never be invoked with the self user.
    expect(resolveCursor).not.toHaveBeenCalledWith(expect.anything(), "self");

    await act(async () => {
      root.unmount();
    });
  });

  it("caps recentActivity at maxRecentActivity (FIFO)", async () => {
    const adapter = new FullMockAdapter();
    const contextRef: { current: PresenceContextValue | null } = {
      current: null,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PresenceProvider
          adapter={adapter}
          autoConnect={false}
          maxRecentActivity={3}
        >
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

    // Fire five joins; the cap of 3 should evict the two oldest.
    for (let i = 0; i < 5; i++) {
      const peer: PresenceUser = {
        userId: `peer-${i}`,
        name: `Peer ${i}`,
        color: "#111",
        status: "active",
        lastActiveAt: i,
      };
      act(() => {
        adapter.emitJoin(peer);
      });
    }

    expect(contextRef.current?.recentActivity).toHaveLength(3);
    // Newest first
    expect(contextRef.current?.recentActivity[0]?.userId).toBe("peer-4");
    expect(contextRef.current?.recentActivity[2]?.userId).toBe("peer-2");

    await act(async () => {
      root.unmount();
    });
  });

  it("does not tear down adapter subscriptions when only maxRecentActivity changes", async () => {
    const adapter = new FullMockAdapter();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PresenceProvider
          adapter={adapter}
          autoConnect={false}
          maxRecentActivity={10}
        >
          <span />
        </PresenceProvider>,
      );
    });

    // Subscriptions registered once during initial mount.
    const initialPresenceSubs = adapter.presenceCallbacks.size;
    const initialEventSubs = adapter.eventCallbacks.size;
    const initialConnectionSubs = adapter.connectionCallbacks.size;

    // Re-render with a different cap. If the cap weren't ref-stored, the
    // subscription effect would tear down and re-register all callbacks.
    await act(async () => {
      root.render(
        <PresenceProvider
          adapter={adapter}
          autoConnect={false}
          maxRecentActivity={25}
        >
          <span />
        </PresenceProvider>,
      );
    });

    expect(adapter.presenceCallbacks.size).toBe(initialPresenceSubs);
    expect(adapter.eventCallbacks.size).toBe(initialEventSubs);
    expect(adapter.connectionCallbacks.size).toBe(initialConnectionSubs);

    // Cap enforcement under a changed value is covered by the
    // `caps recentActivity at maxRecentActivity (FIFO)` test above; this
    // test stays focused on subscription stability.

    await act(async () => {
      root.unmount();
    });
  });

  it("emits an IDLE activity event when status sweep demotes a user", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));

    const adapter = new FullMockAdapter();
    const contextRef: { current: PresenceContextValue | null } = {
      current: null,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PresenceProvider
          adapter={adapter}
          autoConnect={false}
          statusConfig={{
            maxActivities: 100,
            idleTimeoutMs: 1_000,
            offlineTimeoutMs: 60_000,
            cursorThrottleMs: 50,
          }}
          statusSweepMs={500}
        >
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
      lastActiveAt: Date.now(),
    };
    const peer: PresenceUser = {
      userId: "peer-idle",
      name: "Peer",
      color: "#111",
      status: "active",
      lastActiveAt: Date.now(),
    };
    act(() => {
      adapter.emitConnected(self);
      adapter.emitJoin(peer);
    });

    // Advance past the idle threshold so the next sweep tick demotes peer.
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });

    const idleEvents = (contextRef.current?.recentActivity ?? []).filter(
      (e) => e.type === "idle",
    );
    // Both self and peer have stale lastActiveAt by t=1500, so both should
    // be demoted exactly once.
    expect(idleEvents).toHaveLength(2);
    expect(idleEvents.map((e) => e.userId).sort()).toEqual([
      "peer-idle",
      "self",
    ]);
    expect(contextRef.current?.presence.get("peer-idle")?.status).toBe("idle");
    expect(contextRef.current?.self?.status).toBe("idle");

    await act(async () => {
      root.unmount();
    });
    vi.useRealTimers();
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
