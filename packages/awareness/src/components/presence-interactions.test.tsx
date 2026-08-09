/**
 * Interaction behavior from the awareness and presence design model:
 *   - LiveCursor off-screen culling (§7)
 *   - LiveCursor default fade ≈ 3000 ms (§6)
 *   - SelectionHighlight hover-to-reveal label (§5.3)
 *   - BlockActivityIndicator per-block aggregation (§5.4)
 *   - PresenceProvider local idle/offline status sweep (§4.2)
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
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
import { PresenceContext } from "../providers/presence-context";
import { PresenceProvider } from "../providers/presence-provider";
import type { PresenceUser } from "../types/presence";
import { BlockActivityIndicator } from "./block-activity-indicator";
import { LiveCursor } from "./live-cursor";
import { SelectionHighlight } from "./selection-highlight";
import { InTestLayer } from "./test-utils";

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const user = (
  id: string,
  overrides: Partial<Omit<PresenceUser, "userId">> = {},
): PresenceUser => ({
  userId: id,
  connectionId: id,
  name: `User ${id}`,
  color: "#2563eb",
  status: "active",
  lastActivityAt: 1000,
  lastSeenAt: 1000,
  clock: 0,
  ...overrides,
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("LiveCursor off-screen culling (design §7)", () => {
  it("renders when point is inside the window viewport", () => {
    const html = renderToStaticMarkup(
      <InTestLayer>
        <LiveCursor point={{ x: 100, y: 100 }} user={user("a")} />
      </InTestLayer>,
    );
    expect(html).toContain("awareness-live-cursor");
  });

  it("returns null when point is far outside the window viewport", () => {
    const html = renderToStaticMarkup(
      <InTestLayer>
        <LiveCursor point={{ x: 999_999, y: 999_999 }} user={user("a")} />
      </InTestLayer>,
    );
    expect(html).toBe("");
  });

  it("honors an explicit viewport rect", () => {
    const inside = renderToStaticMarkup(
      <InTestLayer>
        <LiveCursor
          point={{ x: 50, y: 50 }}
          user={user("a")}
          viewport={{ x: 0, y: 0, width: 200, height: 200 }}
        />
      </InTestLayer>,
    );
    const outside = renderToStaticMarkup(
      <InTestLayer>
        <LiveCursor
          point={{ x: 500, y: 500 }}
          user={user("a")}
          cullMargin={0}
          viewport={{ x: 0, y: 0, width: 200, height: 200 }}
        />
      </InTestLayer>,
    );
    expect(inside).toContain("awareness-live-cursor");
    expect(outside).toBe("");
  });

  it('never culls when viewport="none"', () => {
    const html = renderToStaticMarkup(
      <InTestLayer>
        <LiveCursor
          point={{ x: 999_999, y: 999_999 }}
          user={user("a")}
          viewport="none"
        />
      </InTestLayer>,
    );
    expect(html).toContain("awareness-live-cursor");
  });

  it("re-evaluates window-based culling on resize", async () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <InTestLayer>
            <LiveCursor
              cullMargin={0}
              point={{ x: 400, y: 400 }}
              user={user("a")}
            />
          </InTestLayer>,
        );
      });
      expect(container.querySelector(".awareness-live-cursor")).not.toBeNull();

      // Shrink the window and dispatch resize — cursor should re-evaluate
      // and cull itself without any pointer movement.
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 100,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 100,
      });
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
      });

      expect(container.querySelector(".awareness-live-cursor")).toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      });

      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});

describe("SelectionHighlight hover-to-reveal label (design §5.3)", () => {
  it('adds hoverable class when showLabel="hover"', () => {
    const html = renderToStaticMarkup(
      <InTestLayer>
        <SelectionHighlight
          rect={{ x: 0, y: 0, width: 10, height: 10 }}
          showLabel="hover"
          user={user("a", { name: "Hover" })}
        />
      </InTestLayer>,
    );
    expect(html).toContain("awareness-selection-highlight--hoverable");
    expect(html).toContain("Hover");
    expect(html).toContain('tabindex="0"');
  });

  it("does not add hoverable class for boolean showLabel", () => {
    const truthy = renderToStaticMarkup(
      <InTestLayer>
        <SelectionHighlight
          rect={{ x: 0, y: 0, width: 10, height: 10 }}
          showLabel
          user={user("a", { name: "Vis" })}
        />
      </InTestLayer>,
    );
    expect(truthy).not.toContain("awareness-selection-highlight--hoverable");
    expect(truthy).toContain("Vis");
  });
});

describe("LiveCursor hover-to-reveal label (design §5.3)", () => {
  it('adds hoverable class, tabindex, and renders label when showLabel="hover"', () => {
    const html = renderToStaticMarkup(
      <InTestLayer>
        <LiveCursor
          point={{ x: 0, y: 0 }}
          showLabel="hover"
          user={user("a", { name: "HoverCaret" })}
        />
      </InTestLayer>,
    );
    expect(html).toContain("awareness-live-cursor--hoverable");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("HoverCaret");
    // Hoverable cursors don't get the always-on label-visible class —
    // CSS :hover/:focus-visible drives opacity instead.
    expect(html).not.toContain("awareness-live-cursor--label-visible");
  });

  it("does not add hoverable class for boolean showLabel", () => {
    const truthy = renderToStaticMarkup(
      <InTestLayer>
        <LiveCursor
          point={{ x: 0, y: 0 }}
          showLabel
          user={user("a", { name: "VisCaret" })}
        />
      </InTestLayer>,
    );
    expect(truthy).not.toContain("awareness-live-cursor--hoverable");
    expect(truthy).toContain("VisCaret");

    const hidden = renderToStaticMarkup(
      <InTestLayer>
        <LiveCursor
          point={{ x: 0, y: 0 }}
          showLabel={false}
          user={user("a", { name: "HiddenCaret" })}
        />
      </InTestLayer>,
    );
    expect(hidden).not.toContain("awareness-live-cursor--hoverable");
    // The label span itself isn't rendered when showLabel={false}; the
    // name still appears inside the aria-label, which is expected.
    expect(hidden).not.toContain("awareness-live-cursor__label");
  });
});

describe("BlockActivityIndicator (design §5.4)", () => {
  const a = user("a", {
    name: "Ada",
    cursor: { blockId: "b1", offset: 0 },
  });
  const b = user("b", {
    name: "Bea",
    selection: { blockId: "b1", from: 0, to: 5 },
  });
  const c = user("c", { name: "Cam", cursor: { blockId: "other", offset: 0 } });
  const directional = user("directional", {
    name: "Dia",
    selection: {
      anchor: {
        blockId: "other",
        anchor: {
          type: "boundary",
          edge: "end",
          affinity: "before",
        },
      },
      focus: {
        blockId: "b1",
        anchor: {
          type: "boundary",
          edge: "start",
          affinity: "after",
        },
      },
    },
  });

  it("renders nothing when no one is in the block", () => {
    const html = renderToStaticMarkup(
      <BlockActivityIndicator blockId="b1" users={[c]} />,
    );
    expect(html).toBe("");
  });

  it("renders single-user phrasing", () => {
    const html = renderToStaticMarkup(
      <BlockActivityIndicator blockId="b1" users={[a, c]} />,
    );
    expect(html).toContain("Ada is editing this block");
  });

  it("renders multi-user count", () => {
    const html = renderToStaticMarkup(
      <BlockActivityIndicator blockId="b1" users={[a, b, c]} />,
    );
    expect(html).toContain("2 people editing here");
  });

  it("counts a directional selection at either endpoint block", () => {
    const focusHtml = renderToStaticMarkup(
      <BlockActivityIndicator blockId="b1" users={[directional]} />,
    );
    const anchorHtml = renderToStaticMarkup(
      <BlockActivityIndicator blockId="other" users={[directional]} />,
    );

    expect(focusHtml).toContain("Dia is editing this block");
    expect(anchorHtml).toContain("Dia is editing this block");
  });

  it("excludes offline users by default", () => {
    const offline = user("d", {
      name: "Dee",
      status: "offline",
      cursor: { blockId: "b1", offset: 0 },
    });
    const html = renderToStaticMarkup(
      <BlockActivityIndicator blockId="b1" users={[offline]} />,
    );
    expect(html).toBe("");
  });

  it("renders empty label when renderWhenEmpty is set", () => {
    const html = renderToStaticMarkup(
      <BlockActivityIndicator
        blockId="b1"
        emptyLabel="Quiet here"
        renderWhenEmpty
        users={[]}
      />,
    );
    expect(html).toContain("Quiet here");
  });

  it("includes self when includeSelf=true and reads from context.presence", () => {
    const self = user("self", {
      name: "Self",
      cursor: { blockId: "b1", offset: 0 },
    });
    const ctxValue = {
      connectionState: "connected" as const,
      self,
      presence: new Map([
        [self.userId, self],
        [a.userId, a],
      ]),
      others: [a],
      recentActivity: [],
      updatePresence: vi.fn(),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      adapter: null,
    };

    const html = renderToStaticMarkup(
      <PresenceContext.Provider value={ctxValue}>
        <BlockActivityIndicator blockId="b1" includeSelf />
      </PresenceContext.Provider>,
    );
    // Both self + ada are in block b1.
    expect(html).toContain("2 people editing here");
  });

  it("falls back to an empty list when context has no presence map", () => {
    const ctxValue = {
      connectionState: "connected" as const,
      self: null,
      // Force the `ctxPresence ? ... : []` else branch to exercise.
      presence: undefined as unknown as ReadonlyMap<string, PresenceUser>,
      others: [] as ReadonlyArray<PresenceUser>,
      recentActivity: [],
      updatePresence: vi.fn(),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      adapter: null,
    };

    const html = renderToStaticMarkup(
      <PresenceContext.Provider value={ctxValue}>
        <BlockActivityIndicator blockId="b1" includeSelf />
      </PresenceContext.Provider>,
    );
    expect(html).toBe("");
  });

  it("reads from PresenceContext when no users prop is provided", () => {
    const ctxValue = {
      connectionState: "connected" as const,
      self: null,
      presence: new Map([
        [a.userId, a],
        [b.userId, b],
      ]),
      others: [a, b],
      recentActivity: [],
      updatePresence: vi.fn(),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      adapter: null,
    };

    const html = renderToStaticMarkup(
      <PresenceContext.Provider value={ctxValue}>
        <BlockActivityIndicator blockId="b1" />
      </PresenceContext.Provider>,
    );
    expect(html).toContain("2 people editing here");
  });
});

class StatusSweepAdapter implements PresenceAdapter {
  presenceCallbacks = new Set<PresenceCallback>();
  eventCallbacks = new Set<EventCallback>();
  connectionCallbacks = new Set<ConnectionCallback>();
  errorCallbacks = new Set<ErrorCallback>();

  state: AdapterConnectionState = "disconnected";
  presence: ReadonlyMap<string, PresenceUser> = new Map();
  self: PresenceUser | null = null;

  connect = vi.fn(async (): Promise<void> => {});
  disconnect = vi.fn(async (): Promise<void> => {});
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

  pushPresence = (next: ReadonlyMap<string, PresenceUser>): void => {
    this.presence = next;
    for (const cb of this.presenceCallbacks) cb(next);
  };
}

describe("PresenceProvider status sweep (design §4.2)", () => {
  it("demotes stale users from active to idle to offline over time", async () => {
    vi.useFakeTimers();
    const adapter = new StatusSweepAdapter();

    let observedStatus: string | undefined;
    const Probe = (): null => {
      // Read from context via a ref-y consumer
      return null;
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
            maxActivities: 10,
            idleTimeoutMs: 1_000,
            offlineTimeoutMs: 2_000,
            cursorThrottleMs: 50,
          }}
          statusSweepMs={500}
        >
          <PresenceContext.Consumer>
            {(value) => {
              observedStatus = value?.presence.get("stale")?.status;
              return <Probe />;
            }}
          </PresenceContext.Consumer>
        </PresenceProvider>,
      );
    });

    const stale = user("stale", {
      name: "Stale",
      lastActivityAt: Date.now() - 1_500, // older than idle threshold,
      lastSeenAt: Date.now() - 1_500,
      clock: 0, // older than idle threshold
      status: "active",
    });

    act(() => {
      adapter.pushPresence(new Map([[stale.connectionId, stale]]));
    });
    expect(observedStatus).toBe("active");

    // First sweep should mark them idle (elapsed > 1s).
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(observedStatus).toBe("idle");

    // After more time passes, they should go offline (elapsed > 2s).
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(observedStatus).toBe("offline");

    await act(async () => {
      root.unmount();
    });
  });

  it("demotes self when self goes stale", async () => {
    vi.useFakeTimers();
    const adapter = new StatusSweepAdapter();
    let observedSelfStatus: string | undefined;

    const selfUser = user("self", {
      name: "Self",
      lastActivityAt: Date.now() - 1_500,
      lastSeenAt: Date.now() - 1_500,
      clock: 0,
      status: "active",
    });
    adapter.self = selfUser;

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PresenceProvider
          adapter={adapter}
          autoConnect={false}
          statusConfig={{
            maxActivities: 10,
            idleTimeoutMs: 1_000,
            offlineTimeoutMs: 2_000,
            cursorThrottleMs: 50,
          }}
          statusSweepMs={500}
        >
          <PresenceContext.Consumer>
            {(value) => {
              observedSelfStatus = value?.self?.status;
              return null;
            }}
          </PresenceContext.Consumer>
        </PresenceProvider>,
      );
    });

    act(() => {
      adapter.pushPresence(new Map([[selfUser.connectionId, selfUser]]));
    });
    expect(observedSelfStatus).toBe("active");

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(observedSelfStatus).toBe("idle");

    await act(async () => {
      root.unmount();
    });
  });

  it("does not demote stale users when statusSweepMs=0", async () => {
    vi.useFakeTimers();
    const adapter = new StatusSweepAdapter();
    let observedStatus: string | undefined;

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PresenceProvider
          adapter={adapter}
          autoConnect={false}
          statusConfig={{
            maxActivities: 10,
            idleTimeoutMs: 1_000,
            offlineTimeoutMs: 2_000,
            cursorThrottleMs: 50,
          }}
          statusSweepMs={0}
        >
          <PresenceContext.Consumer>
            {(value) => {
              observedStatus = value?.presence.get("stale")?.status;
              return null;
            }}
          </PresenceContext.Consumer>
        </PresenceProvider>,
      );
    });

    const stale = user("stale", {
      name: "Stale",
      lastActivityAt: Date.now() - 10_000,
      lastSeenAt: Date.now() - 10_000,
      clock: 0,
      status: "active",
    });

    act(() => {
      adapter.pushPresence(new Map([[stale.connectionId, stale]]));
    });

    // Advance well past both thresholds — without a sweep timer, the
    // status should remain "active" because no sweep ever runs.
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(observedStatus).toBe("active");

    await act(async () => {
      root.unmount();
    });
  });
});
