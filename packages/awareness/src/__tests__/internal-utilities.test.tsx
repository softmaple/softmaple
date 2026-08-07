import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../adapters/adapter-state";
import { createSubscriptionManager } from "../adapters/subscription-manager";
import type {
  AdapterConnectionState,
  ConnectionCallback,
  ErrorCallback,
  EventCallback,
  PresenceAdapter,
  PresenceCallback,
  Unsubscribe,
} from "../adapters/types";
import {
  createInternalState,
  resetInternalState,
  updateInternalState,
} from "../adapters/websocket/state";
import { ActivityIndicator } from "../components/activity-indicator";
import { ConnectionIndicator } from "../components/connection-indicator";
import {
  cx,
  formatPresenceSummary,
  formatRelativeTime,
  getInitials,
  sortPresenceUsers,
} from "../components/internal-utils";
import { PresenceBar } from "../components/presence-bar";
import {
  PresenceContext,
  type PresenceContextValue,
} from "../providers/presence-context";
import { PresenceProvider } from "../providers/presence-provider";
import type { ActivityEvent } from "../types/events";
import { ACTIVITY_TYPE, PRESENCE_EVENT } from "../types/events";
import { createPresenceUser, type PresenceUser } from "../types/presence";

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const reconnectConfig = {
  enabled: true,
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 1000,
};

describe("websocket-state internals", () => {
  it("updateInternalState notifies connection change when connectionState updates", () => {
    const subs = createSubscriptionManager();
    const connection = vi.fn();
    subs.onConnectionChange(connection);
    connection.mockClear();

    const internal = createInternalState(reconnectConfig);
    const next = updateInternalState(
      internal,
      { connectionState: "connected" },
      subs,
    );
    expect(connection).toHaveBeenCalledWith("connected");
    expect(next.state.connectionState).toBe("connected");
  });

  it("updateInternalState notifies presence change when notifyPresence=true", () => {
    const subs = createSubscriptionManager();
    const presence = vi.fn();
    subs.onPresenceChange(presence);
    presence.mockClear();

    const internal = createInternalState(reconnectConfig);
    updateInternalState(internal, {}, subs, true);
    expect(presence).toHaveBeenCalled();
  });

  it("updateInternalState skips notifications when neither flag triggers", () => {
    const subs = createSubscriptionManager();
    const connection = vi.fn();
    const presence = vi.fn();
    subs.onConnectionChange(connection);
    subs.onPresenceChange(presence);
    connection.mockClear();
    presence.mockClear();

    const internal = createInternalState(reconnectConfig);
    updateInternalState(internal, {}, subs);
    expect(connection).not.toHaveBeenCalled();
    expect(presence).not.toHaveBeenCalled();
  });

  it("resetInternalState clears socket and reconnect bookkeeping", () => {
    const internal = createInternalState(reconnectConfig);
    const dirty = {
      ...internal,
      socket: {} as WebSocket,
      reconnect: { ...internal.reconnect, attempts: 5 },
    };
    const reset = resetInternalState(dirty, reconnectConfig);
    expect(reset.socket).toBeNull();
    expect(reset.reconnect.attempts).toBe(0);
    expect(reset.state).toEqual(createInitialState());
  });
});

describe("components/internal-utils", () => {
  it("cx filters falsy entries", () => {
    expect(cx("a", false, null, undefined, "b")).toBe("a b");
    expect(cx()).toBe("");
  });

  it("getInitials handles empty, single, multi-word, whitespace-only names", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials("   ")).toBe("?");
    expect(getInitials("Ada")).toBe("A");
    expect(getInitials("Ada Lovelace")).toBe("AL");
    expect(getInitials("  Ada   Lovelace  Byron ")).toBe("AL");
  });

  it("formatRelativeTime buckets into just-now / s / m / h / d", () => {
    const now = 10_000_000;
    expect(formatRelativeTime(now - 5_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 40_000, now)).toBe("40s ago");
    expect(formatRelativeTime(now - 120_000, now)).toBe("2m ago");
    expect(formatRelativeTime(now - 3 * 60 * 60_000, now)).toBe("3h ago");
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe("2d ago");
    // Future / clock skew → clamped to 0.
    expect(formatRelativeTime(now + 5_000, now)).toBe("just now");
  });

  it("formatRelativeTime floors at bucket boundaries (no jump from 30m to 1h)", () => {
    const now = 10_000_000;
    // 59m59s: still in the minutes bucket, displayed as 59m (floor),
    // not 60m (round would do that).
    expect(formatRelativeTime(now - (60 * 60_000 - 1_000), now)).toBe(
      "59m ago",
    );
    // Exactly one hour switches to the hours bucket.
    expect(formatRelativeTime(now - 60 * 60_000, now)).toBe("1h ago");
  });

  it("formatPresenceSummary varies copy by status and typing meta", () => {
    const base = (overrides: Partial<PresenceUser> = {}): PresenceUser => ({
      userId: "u",
      connectionId: "u",
      name: "User",
      color: "#000",
      status: "active",
      lastActivityAt: 0,
      lastSeenAt: 0,
      clock: 0,
      ...overrides,
    });
    const now = 10_000_000;
    expect(formatPresenceSummary(base(), now)).toBe("Active now");
    expect(formatPresenceSummary(base({ meta: { isTyping: true } }), now)).toBe(
      "Typing now",
    );
    expect(
      formatPresenceSummary(
        base({ status: "idle", lastActivityAt: now - 120_000 }),
        now,
      ),
    ).toBe("Idle · last active 2m ago");
    expect(
      formatPresenceSummary(
        base({
          status: "offline",
          lastActivityAt: now - 60_000,
          lastSeenAt: now - 3 * 60 * 60_000,
        }),
        now,
      ),
    ).toBe("Offline · last seen 3h ago");
  });

  it("sortPresenceUsers ranks active before idle before offline, then by lastActivityAt desc", () => {
    const make = (id: string, status: PresenceUser["status"], ts: number) => ({
      ...createPresenceUser({
        userId: id,
        connectionId: id,
        name: id,
        color: "#000",
      }),
      status,
      lastActivityAt: ts,
      lastSeenAt: ts,
      clock: 0,
    });
    const sorted = sortPresenceUsers([
      make("c", "offline", 5),
      make("a", "active", 100),
      make("b", "idle", 50),
      make("d", "active", 200),
    ]);
    expect(sorted.map((u) => u.userId)).toEqual(["d", "a", "b", "c"]);
  });
});

describe("ActivityIndicator label coverage", () => {
  const activity = (
    type: ActivityEvent["type"],
    userId = "a",
  ): ActivityEvent => ({
    userId,
    timestamp: type === ACTIVITY_TYPE.IDLE ? 1 : 2,
    type,
  });

  const allTypes = [
    [ACTIVITY_TYPE.JOIN, "joined"],
    [ACTIVITY_TYPE.LEAVE, "left"],
    [ACTIVITY_TYPE.CURSOR, "moved cursor"],
    [ACTIVITY_TYPE.SELECTION, "selected text"],
    [ACTIVITY_TYPE.TYPING, "is typing"],
    [ACTIVITY_TYPE.IDLE, "is idle"],
  ] as const;

  for (const [type, fragment] of allTypes) {
    it(`renders fragment "${fragment}" for activity type ${type}`, () => {
      const html = renderToStaticMarkup(
        <ActivityIndicator
          activities={[activity(type)]}
          users={
            new Map([
              [
                "a",
                {
                  userId: "a",
      connectionId: "a",
                  name: "Ada",
                  color: "#000",
                  status: "active",
                  lastActivityAt: 0,
                  lastSeenAt: 0,
      clock: 0,
                },
              ],
            ])
          }
        />,
      );
      expect(html).toContain(fragment);
    });
  }

  it("uses 'Someone' when the user is unknown", () => {
    const html = renderToStaticMarkup(
      <ActivityIndicator
        activities={[activity(ACTIVITY_TYPE.JOIN, "missing")]}
        users={new Map()}
      />,
    );
    expect(html).toContain("Someone joined");
  });

  it("falls back to default fragment for unknown activity types", () => {
    const html = renderToStaticMarkup(
      <ActivityIndicator
        activities={[
          {
            userId: "a",
            timestamp: 1,
            type: "weird-type" as ActivityEvent["type"],
          },
        ]}
        users={
          new Map([
            [
              "a",
              {
                userId: "a",
      connectionId: "a",
                name: "Ada",
                color: "#000",
                status: "active",
                lastActivityAt: 0,
                lastSeenAt: 0,
      clock: 0,
              },
            ],
          ])
        }
      />,
    );
    expect(html).toContain("Ada updated");
  });
});

describe("PresenceBar without context", () => {
  it("renders empty label when no users provided and context is absent", () => {
    const html = renderToStaticMarkup(<PresenceBar emptyLabel="Nobody yet" />);
    expect(html).toContain("Nobody yet");
  });

  it("renders skeleton placeholders when loading", () => {
    const html = renderToStaticMarkup(
      <PresenceBar loading maxVisible={3} users={[]} />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(
      html.match(/awareness-presence-bar__item--skeleton(?!-)/g)?.length,
    ).toBe(3);
  });

  it("wraps the avatar in a focusable button and adds a tooltip when interactive", () => {
    const ada: PresenceUser = {
      userId: "ada",
      connectionId: "ada",
      name: "Ada",
      color: "#000",
      status: "active",
      lastActivityAt: 0,
      lastSeenAt: 0,
      clock: 0,
    };
    const html = renderToStaticMarkup(<PresenceBar users={[ada]} />);
    expect(html).toContain("awareness-presence-bar__button");
    expect(html).toContain('aria-label="Ada"');
    expect(html).toContain("aria-describedby=");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("awareness-presence-bar__item--interactive");
  });

  it("omits the button + tooltip when interactive=false", () => {
    const ada: PresenceUser = {
      userId: "ada",
      connectionId: "ada",
      name: "Ada",
      color: "#000",
      status: "active",
      lastActivityAt: 0,
      lastSeenAt: 0,
      clock: 0,
    };
    const html = renderToStaticMarkup(
      <PresenceBar interactive={false} users={[ada]} />,
    );
    expect(html).not.toContain("awareness-presence-bar__button");
    expect(html).not.toContain('role="tooltip"');
  });
});

describe("ConnectionIndicator", () => {
  it("renders an aria-hidden placeholder when connected and hideWhenConnected is default", () => {
    // Previously this returned `null`; the empty markup caused
    // sibling chrome to expand into the gap on every reconnect flap.
    // The placeholder keeps the layout box but hides it from sighted
    // users (visibility: hidden via the modifier class) and AT
    // (aria-hidden). The visible text still renders inside so the
    // wrapper has its intrinsic width.
    const html = renderToStaticMarkup(
      <ConnectionIndicator state="connected" />,
    );
    expect(html).toContain("awareness-connection-indicator--placeholder");
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders connection copy when degraded", () => {
    const html = renderToStaticMarkup(
      <ConnectionIndicator state="reconnecting" />,
    );
    expect(html).toContain("Reconnecting");
    expect(html).toContain("awareness-connection-indicator--reconnecting");
    expect(html).toContain('role="status"');
  });

  it("honors custom labels", () => {
    const html = renderToStaticMarkup(
      <ConnectionIndicator
        labels={{ error: "Lost connection — retrying" }}
        state="error"
      />,
    );
    expect(html).toContain("Lost connection — retrying");
  });

  it("falls back to PresenceContext.connectionState", () => {
    const ctx: PresenceContextValue = {
      connectionState: "connecting",
      self: null,
      presence: new Map(),
      others: [],
      recentActivity: [],
      updatePresence: vi.fn(),
      connect: async () => {},
      disconnect: async () => {},
      adapter: null,
    };
    const html = renderToStaticMarkup(
      <PresenceContext.Provider value={ctx}>
        <ConnectionIndicator />
      </PresenceContext.Provider>,
    );
    expect(html).toContain("Connecting");
  });

  it("can render even when connected via hideWhenConnected={false}", () => {
    const html = renderToStaticMarkup(
      <ConnectionIndicator hideWhenConnected={false} state="connected" />,
    );
    expect(html).toContain("Live");
    expect(html).toContain("awareness-connection-indicator--connected");
  });
});

describe("PresenceBar with PresenceContext fallback", () => {
  it("uses context.presence when users prop is omitted", () => {
    const ada: PresenceUser = {
      userId: "ada",
      connectionId: "ada",
      name: "Ada",
      color: "#000",
      status: "active",
      lastActivityAt: 0,
      lastSeenAt: 0,
      clock: 0,
    };
    const ctx: PresenceContextValue = {
      connectionState: "connected",
      self: null,
      presence: new Map([["ada", ada]]),
      others: [],
      recentActivity: [],
      updatePresence: vi.fn(),
      connect: async () => {},
      disconnect: async () => {},
      adapter: null,
    };
    const html = renderToStaticMarkup(
      <PresenceContext.Provider value={ctx}>
        <PresenceBar />
      </PresenceContext.Provider>,
    );
    expect(html).toContain("Ada");
  });
});

describe("ActivityIndicator with PresenceContext fallback", () => {
  const ada: PresenceUser = {
    userId: "ada",
      connectionId: "ada",
    name: "Ada",
    color: "#000",
    status: "active",
    lastActivityAt: 0,
    lastSeenAt: 0,
      clock: 0,
  };

  const ctx = (
    activities: ReadonlyArray<ActivityEvent>,
    presence: ReadonlyMap<string, PresenceUser>,
  ): PresenceContextValue => ({
    connectionState: "connected",
    self: null,
    presence,
    others: [],
    recentActivity: activities,
    updatePresence: vi.fn(),
    connect: async () => {},
    disconnect: async () => {},
    adapter: null,
  });

  it("falls back to context.recentActivity and context.presence when props omitted", () => {
    const html = renderToStaticMarkup(
      <PresenceContext.Provider
        value={ctx(
          [
            {
              userId: "ada",
              timestamp: 1,
              type: ACTIVITY_TYPE.JOIN,
              data: { type: "join", user: ada },
            },
          ],
          new Map([["ada", ada]]),
        )}
      >
        <ActivityIndicator />
      </PresenceContext.Provider>,
    );
    expect(html).toContain("Ada joined");
  });
});

class BareAdapter implements PresenceAdapter {
  presenceCallbacks = new Set<PresenceCallback>();
  eventCallbacks = new Set<EventCallback>();
  connectionCallbacks = new Set<ConnectionCallback>();
  errorCallbacks = new Set<ErrorCallback>();

  connectImpl: () => Promise<void> = async () => {};
  disconnectImpl: () => Promise<void> = async () => {};
  state: AdapterConnectionState = "disconnected";
  presence: ReadonlyMap<string, PresenceUser> = new Map();
  self: PresenceUser | null = null;

  connect = vi.fn(async () => this.connectImpl());
  disconnect = vi.fn(async () => this.disconnectImpl());
  getConnectionState = (): AdapterConnectionState => this.state;
  updatePresence = vi.fn();
  broadcast = vi.fn();
  getPresence = (): ReadonlyMap<string, PresenceUser> => this.presence;
  getSelf = (): PresenceUser | null => this.self;

  onPresenceChange = (cb: PresenceCallback): Unsubscribe => {
    this.presenceCallbacks.add(cb);
    return () => {
      this.presenceCallbacks.delete(cb);
    };
  };
  onEvent = (cb: EventCallback): Unsubscribe => {
    this.eventCallbacks.add(cb);
    return () => {
      this.eventCallbacks.delete(cb);
    };
  };
  onConnectionChange = (cb: ConnectionCallback): Unsubscribe => {
    this.connectionCallbacks.add(cb);
    return () => {
      this.connectionCallbacks.delete(cb);
    };
  };
  onError = (cb: ErrorCallback): Unsubscribe => {
    this.errorCallbacks.add(cb);
    return () => {
      this.errorCallbacks.delete(cb);
    };
  };

  emitEvent = (event: Parameters<EventCallback>[0]): void => {
    for (const cb of this.eventCallbacks) cb(event);
  };
}

describe("PresenceProvider activity branches", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("ignores UPDATE events that don't match cursor/selection/typing", async () => {
    const adapter = new BareAdapter();
    const ref: { current: PresenceContextValue | null } = { current: null };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PresenceProvider adapter={adapter} autoConnect={false}>
          <PresenceContext.Consumer>
            {(v) => {
              ref.current = v;
              return null;
            }}
          </PresenceContext.Consumer>
        </PresenceProvider>,
      );
    });

    act(() => {
      adapter.emitEvent({
        type: PRESENCE_EVENT.UPDATE,
        payload: {
          type: PRESENCE_EVENT.UPDATE,
          connectionId: "peer",
          userId: "peer",
          clock: 1,
          updates: { status: "idle" },
        },
        timestamp: 1,
      });
    });
    expect(ref.current?.recentActivity).toEqual([]);

    act(() => {
      adapter.emitEvent({
        type: PRESENCE_EVENT.UPDATE,
        payload: {
          type: PRESENCE_EVENT.UPDATE,
          connectionId: "peer",
          userId: "peer",
          clock: 1,
          updates: { selection: { blockId: "b", from: 1, to: 5 } },
        },
        timestamp: 2,
      });
    });
    expect(ref.current?.recentActivity).toHaveLength(1);
    expect(ref.current?.recentActivity[0]?.type).toBe(ACTIVITY_TYPE.SELECTION);

    act(() => {
      adapter.emitEvent({
        type: PRESENCE_EVENT.UPDATE,
        payload: {
          type: PRESENCE_EVENT.UPDATE,
          connectionId: "peer",
          userId: "peer",
          clock: 1,
          updates: { cursor: { blockId: "b", offset: 0 } },
        },
        timestamp: 3,
      });
    });
    expect(ref.current?.recentActivity[0]?.type).toBe(ACTIVITY_TYPE.CURSOR);

    act(() => {
      adapter.emitEvent({
        type: PRESENCE_EVENT.LEAVE,
        payload: {
          type: PRESENCE_EVENT.LEAVE,
          connectionId: "peer",
          userId: "peer",
        },
        timestamp: 4,
      });
    });
    expect(ref.current?.recentActivity[0]?.type).toBe(ACTIVITY_TYPE.LEAVE);

    act(() => {
      adapter.emitEvent({
        // unknown event type → default branch
        type: "presence:weird" as never,
        payload: {
          type: PRESENCE_EVENT.UPDATE,
          connectionId: "peer",
          userId: "peer",
          clock: 1,
          updates: {},
        },
        timestamp: 5,
      });
    });

    // Mismatched event type vs payload.type (defensive guards in
    // presenceEventToActivity): type=JOIN but payload.type=UPDATE.
    const before = ref.current?.recentActivity.length;
    act(() => {
      adapter.emitEvent({
        type: PRESENCE_EVENT.JOIN,
        payload: {
          type: PRESENCE_EVENT.UPDATE,
          connectionId: "peer",
          userId: "peer",
          clock: 1,
          updates: {},
        } as never,
        timestamp: 6,
      });
      adapter.emitEvent({
        type: PRESENCE_EVENT.LEAVE,
        payload: {
          type: PRESENCE_EVENT.UPDATE,
          connectionId: "peer",
          userId: "peer",
          clock: 1,
          updates: {},
        } as never,
        timestamp: 7,
      });
      adapter.emitEvent({
        type: PRESENCE_EVENT.UPDATE,
        payload: {
          type: PRESENCE_EVENT.JOIN,
          user: createPresenceUser({
            userId: "peer",
      connectionId: "peer",
            name: "Peer",
            color: "#000",
          }),
        } as never,
        timestamp: 8,
      });
    });
    expect(ref.current?.recentActivity.length).toBe(before);

    await act(async () => {
      root.unmount();
    });
  });

  it("logs but does not throw when adapter.disconnect rejects on unmount", async () => {
    const adapter = new BareAdapter();
    adapter.disconnectImpl = async () => {
      throw new Error("disconnect failed");
    };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

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

    await act(async () => {
      root.unmount();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to disconnect"),
      expect.any(Error),
    );

    consoleError.mockRestore();
  });
});
