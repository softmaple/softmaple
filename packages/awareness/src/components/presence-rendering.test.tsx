import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_TYPE, type ActivityEvent } from "../types/events";
import type { PresenceUser } from "../types/presence";
import { ActivityIndicator } from "./activity-indicator";
import { LiveCursor } from "./live-cursor";
import { PresenceAvatar } from "./presence-avatar";
import { PresenceBar } from "./presence-bar";
import { PresenceLayer } from "./presence-layer";
import { SelectionHighlight } from "./selection-highlight";
import { InTestLayer } from "./test-utils";

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const createUser = (
  userId: string,
  overrides: Partial<Omit<PresenceUser, "userId">> = {},
): PresenceUser => ({
  userId,
  name: `User ${userId}`,
  color: "#2563eb",
  status: "active",
  lastActiveAt: 1000,
  ...overrides,
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("presence components", () => {
  it("renders initials and status on PresenceAvatar", () => {
    const html = renderToStaticMarkup(
      <PresenceAvatar
        user={createUser("1", {
          name: "Ada Lovelace",
          status: "idle",
        })}
      />,
    );

    expect(html).toContain("Ada Lovelace, idle");
    expect(html).toContain("AL");
    expect(html).toContain("awareness-avatar--idle");
  });

  it("sorts visible users and renders overflow in PresenceBar", () => {
    const users = [
      createUser("offline", { name: "Offline", status: "offline" }),
      createUser("idle", {
        name: "Idle",
        status: "idle",
        lastActiveAt: 3000,
      }),
      createUser("active", {
        name: "Active",
        status: "active",
        lastActiveAt: 2000,
      }),
    ] as const;

    const html = renderToStaticMarkup(
      <PresenceBar includeOffline maxVisible={2} users={users} />,
    );

    expect(html.indexOf("Active")).toBeLessThan(html.indexOf("Idle"));
    expect(html).toContain("+1");
    expect(html).toContain("Offline");
  });

  it("renders activity labels with known user names", () => {
    const user = createUser("1", { name: "Lin" });
    const activities: ReadonlyArray<ActivityEvent> = [
      {
        userId: user.userId,
        timestamp: 123,
        type: ACTIVITY_TYPE.TYPING,
        data: { type: ACTIVITY_TYPE.TYPING, isTyping: true },
      },
    ];

    const html = renderToStaticMarkup(
      <ActivityIndicator
        activities={activities}
        users={new Map([[user.userId, user]])}
      />,
    );

    expect(html).toContain("Lin is typing");
  });

  it("renders cursor and selection coordinates as transforms", () => {
    const user = createUser("1", { name: "Grace" });

    const cursorHtml = renderToStaticMarkup(
      <InTestLayer>
        <LiveCursor point={{ x: 12, y: 24 }} user={user} />
      </InTestLayer>,
    );
    const selectionHtml = renderToStaticMarkup(
      <InTestLayer>
        <SelectionHighlight
          rect={{ x: 4, y: 8, width: 120, height: 20 }}
          selectedText="shared note"
          showLabel
          user={user}
        />
      </InTestLayer>,
    );

    expect(cursorHtml).toContain("translate3d(12px, 24px, 0)");
    expect(selectionHtml).toContain("translate3d(4px, 8px, 0)");
    expect(selectionHtml).toContain("Grace selection: shared note");
    expect(selectionHtml).toContain("Grace");
  });

  it("renders avatarUrl image and skips status dot when showStatus=false", () => {
    const html = renderToStaticMarkup(
      <PresenceAvatar
        showStatus={false}
        user={createUser("1", {
          name: "Ada",
          avatarUrl: "https://example.com/a.png",
        })}
      />,
    );
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).not.toContain("awareness-avatar__status");
  });

  it("falls back to a plain selection aria-label when selectedText is missing", () => {
    const user = createUser("1", { name: "Grace" });

    const undefinedHtml = renderToStaticMarkup(
      <InTestLayer>
        <SelectionHighlight
          rect={{ x: 0, y: 0, width: 10, height: 10 }}
          user={user}
        />
      </InTestLayer>,
    );
    const emptyHtml = renderToStaticMarkup(
      <InTestLayer>
        <SelectionHighlight
          rect={{ x: 0, y: 0, width: 10, height: 10 }}
          selectedText=""
          user={user}
        />
      </InTestLayer>,
    );

    expect(undefinedHtml).toContain('aria-label="Grace selection"');
    expect(undefinedHtml).not.toContain("Grace selection:");
    expect(emptyHtml).toContain('aria-label="Grace selection"');
    expect(emptyHtml).not.toContain("Grace selection:");
  });

  it("clamps long selectedText in the selection aria-label", () => {
    const user = createUser("1", { name: "Grace" });
    const longText = "a".repeat(200);

    const html = renderToStaticMarkup(
      <InTestLayer>
        <SelectionHighlight
          rect={{ x: 0, y: 0, width: 10, height: 10 }}
          selectedText={longText}
          user={user}
        />
      </InTestLayer>,
    );

    expect(html).toContain(`Grace selection: ${"a".repeat(120)}…`);
    expect(html).not.toContain("a".repeat(121));
  });

  it("translates host-local cursor and selection coordinates by the layer offset", async () => {
    const user = createUser("1", { name: "Hostie" });

    const HOST_LEFT = 40;
    const HOST_TOP = 80;
    // jsdom's `getBoundingClientRect` is hard-coded to 0/0, so override
    // the host element's per-instance to simulate it sitting at (40, 80).
    const Harness = (): React.ReactNode => {
      const hostRef = useRef<HTMLDivElement | null>(null);
      return (
        <>
          <div
            ref={(el) => {
              if (!el) return;
              hostRef.current = el;
              el.getBoundingClientRect = () =>
                ({
                  left: HOST_LEFT,
                  top: HOST_TOP,
                  right: HOST_LEFT + 200,
                  bottom: HOST_TOP + 100,
                  width: 200,
                  height: 100,
                  x: HOST_LEFT,
                  y: HOST_TOP,
                  toJSON() {
                    return {};
                  },
                }) as DOMRect;
            }}
          />
          <PresenceLayer host={hostRef}>
            <LiveCursor point={{ x: 5, y: 7 }} showLabel={false} user={user} />
            <SelectionHighlight
              rect={{ x: 10, y: 12, width: 30, height: 18 }}
              user={user}
            />
          </PresenceLayer>
        </>
      );
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Harness />);
    });

    const cursor = container.querySelector(".awareness-live-cursor");
    const selection = container.querySelector(".awareness-selection-highlight");
    expect(cursor).toBeInstanceOf(HTMLElement);
    expect(selection).toBeInstanceOf(HTMLElement);

    // 5 + 40 = 45, 7 + 80 = 87
    expect((cursor as HTMLElement).style.transform).toBe(
      "translate3d(45px, 87px, 0)",
    );
    // 10 + 40 = 50, 12 + 80 = 92
    expect((selection as HTMLElement).style.transform).toBe(
      "translate3d(50px, 92px, 0)",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("measures the host on the next frame when its ref is on an ancestor of the layer", async () => {
    const user = createUser("1", { name: "Ancestor" });

    const HOST_LEFT = 60;
    const HOST_TOP = 90;

    // Stories wrap `<PresenceLayer>` *inside* the host div, so
    // `host.current` is `null` when the layer's layout effect runs
    // (parent host refs attach after their children's layout effects).
    // The layer must defer measurement to the next frame instead of
    // bailing — otherwise the offset stays at (0,0) and overlays
    // render at the viewport top-left.
    const Harness = (): React.ReactNode => {
      const hostRef = useRef<HTMLDivElement | null>(null);
      return (
        <div
          ref={(el) => {
            if (!el) return;
            hostRef.current = el;
            el.getBoundingClientRect = () =>
              ({
                left: HOST_LEFT,
                top: HOST_TOP,
                right: HOST_LEFT + 200,
                bottom: HOST_TOP + 100,
                width: 200,
                height: 100,
                x: HOST_LEFT,
                y: HOST_TOP,
                toJSON() {
                  return {};
                },
              }) as DOMRect;
          }}
        >
          <PresenceLayer host={hostRef}>
            <LiveCursor point={{ x: 5, y: 7 }} showLabel={false} user={user} />
          </PresenceLayer>
        </div>
      );
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Harness />);
    });

    // Flush the rAF the layer scheduled when it found host.current
    // null. jsdom's rAF resolves on the next microtask boundary, so a
    // single `act` tick is enough to surface the re-render.
    await act(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(null)),
      );
    });

    const cursor = container.querySelector(".awareness-live-cursor");
    expect(cursor).toBeInstanceOf(HTMLElement);
    // host(60, 90) + point(5, 7) = (65, 97)
    expect((cursor as HTMLElement).style.transform).toBe(
      "translate3d(65px, 97px, 0)",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the offset invariant when host and layer scroll together with the page", async () => {
    const user = createUser("1", { name: "Scrolled" });

    // The layer measures `hostRect - layerRect`, so a shared scroll
    // delta cancels out and the offset is unchanged. This is what
    // eliminates the one-frame lag the old `position: fixed` design
    // had during window scroll — the listener still fires, but
    // `setOffset` early-returns when values match and no re-render
    // (and no transform update on children) happens.
    const HOST_LEFT = 80;
    const HOST_TOP = 120;
    let hostEl: HTMLDivElement | null = null;
    let layerEl: HTMLElement | null = null;
    let scrollDelta = 0;

    const Harness = (): React.ReactNode => {
      const hostRef = useRef<HTMLDivElement | null>(null);
      return (
        <>
          <div
            ref={(el) => {
              if (!el) return;
              hostRef.current = el;
              hostEl = el;
              el.getBoundingClientRect = () =>
                ({
                  left: HOST_LEFT,
                  top: HOST_TOP - scrollDelta,
                  right: HOST_LEFT + 200,
                  bottom: HOST_TOP + 100 - scrollDelta,
                  width: 200,
                  height: 100,
                  x: HOST_LEFT,
                  y: HOST_TOP - scrollDelta,
                  toJSON() {
                    return {};
                  },
                }) as DOMRect;
            }}
          />
          <PresenceLayer host={hostRef}>
            <LiveCursor point={{ x: 5, y: 7 }} showLabel={false} user={user} />
          </PresenceLayer>
        </>
      );
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Harness />);
    });

    layerEl = container.querySelector(".awareness-presence-layer");
    expect(layerEl).not.toBeNull();
    // Make the layer move with the same scroll delta as the host —
    // simulates the document scrolling and both elements shifting up
    // together.
    (layerEl as HTMLElement).getBoundingClientRect = () =>
      ({
        left: 0,
        top: -scrollDelta,
        right: 0,
        bottom: -scrollDelta,
        width: 0,
        height: 0,
        x: 0,
        y: -scrollDelta,
        toJSON() {
          return {};
        },
      }) as DOMRect;

    // Initial transform: host(80, 120) - layer(0, 0) + point(5, 7) = (85, 127)
    const cursor = container.querySelector(
      ".awareness-live-cursor",
    ) as HTMLElement;
    expect(cursor.style.transform).toBe("translate3d(85px, 127px, 0)");

    // Simulate the page scrolling down 50px: both host and layer
    // shift up by 50.
    scrollDelta = 50;
    expect(hostEl).not.toBeNull();
    const target = hostEl as unknown as HTMLDivElement;
    await act(async () => {
      target.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    // Offset (host − layer) is unchanged, so the transform is too.
    // Children render at the same coordinates *relative to the
    // layer's box*, and the layer itself scrolled with the page —
    // the visible viewport position follows naturally without a JS
    // re-render of the child.
    expect(cursor.style.transform).toBe("translate3d(85px, 127px, 0)");

    await act(async () => {
      root.unmount();
    });
  });

  it("folds host.scrollLeft/scrollTop into the offset when trackHostScroll is set", async () => {
    const user = createUser("1", { name: "Scrollie" });

    const HOST_LEFT = 50;
    const HOST_TOP = 100;
    const HOST_SCROLL_LEFT = 13;
    const HOST_SCROLL_TOP = 21;

    // The harness keeps a handle on the host element so the test can
    // mutate `scrollLeft` / `scrollTop` and fire a scroll event to
    // verify the layer re-reads scroll on the capture-phase listener.
    let hostEl: HTMLDivElement | null = null;

    const Harness = (): React.ReactNode => {
      const hostRef = useRef<HTMLDivElement | null>(null);
      return (
        <>
          <div
            ref={(el) => {
              if (!el) return;
              hostRef.current = el;
              hostEl = el;
              el.getBoundingClientRect = () =>
                ({
                  left: HOST_LEFT,
                  top: HOST_TOP,
                  right: HOST_LEFT + 200,
                  bottom: HOST_TOP + 100,
                  width: 200,
                  height: 100,
                  x: HOST_LEFT,
                  y: HOST_TOP,
                  toJSON() {
                    return {};
                  },
                }) as DOMRect;
              // jsdom keeps `scrollLeft`/`scrollTop` writable; the
              // layer reads them on every update so we set them once
              // here and let the initial layout effect pick them up.
              Object.defineProperty(el, "scrollLeft", {
                configurable: true,
                writable: true,
                value: HOST_SCROLL_LEFT,
              });
              Object.defineProperty(el, "scrollTop", {
                configurable: true,
                writable: true,
                value: HOST_SCROLL_TOP,
              });
            }}
          />
          <PresenceLayer host={hostRef} trackHostScroll>
            <LiveCursor point={{ x: 5, y: 7 }} showLabel={false} user={user} />
          </PresenceLayer>
        </>
      );
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Harness />);
    });

    const cursor = container.querySelector(".awareness-live-cursor");
    expect(cursor).toBeInstanceOf(HTMLElement);
    // host(50,100) - scroll(13,21) + point(5,7) = (42, 86)
    expect((cursor as HTMLElement).style.transform).toBe(
      "translate3d(42px, 86px, 0)",
    );

    // Now scroll the host. The layer subscribes to capture-phase
    // window scroll events, which bubble up from the host element, so
    // dispatching a scroll event on the host (with `bubbles: true`,
    // since capture-phase listeners on window also see bubbling
    // events on their way down the tree) should re-trigger `update()`
    // and fold the new scroll offset in.
    expect(hostEl).not.toBeNull();
    const target = hostEl as unknown as HTMLDivElement;
    await act(async () => {
      Object.defineProperty(target, "scrollLeft", {
        configurable: true,
        writable: true,
        value: 30,
      });
      Object.defineProperty(target, "scrollTop", {
        configurable: true,
        writable: true,
        value: 45,
      });
      target.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    // host(50,100) - scroll(30,45) + point(5,7) = (25, 62)
    expect((cursor as HTMLElement).style.transform).toBe(
      "translate3d(25px, 62px, 0)",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("warns once when LiveCursor or SelectionHighlight is rendered without a PresenceLayer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const user = createUser("1", { name: "Lone" });

    // Rendered without an <InTestLayer> wrapper — both components should
    // bail out and emit a single dev warning naming themselves. The
    // dedupe set inside `presence-layer.tsx` is module-scoped so the
    // second render of the same component must NOT re-warn.
    const cursorHtml = renderToStaticMarkup(
      <LiveCursor point={{ x: 0, y: 0 }} user={user} />,
    );
    const cursorHtmlAgain = renderToStaticMarkup(
      <LiveCursor point={{ x: 1, y: 1 }} user={user} />,
    );
    const selectionHtml = renderToStaticMarkup(
      <SelectionHighlight
        rect={{ x: 0, y: 0, width: 10, height: 10 }}
        user={user}
      />,
    );
    const selectionHtmlAgain = renderToStaticMarkup(
      <SelectionHighlight
        rect={{ x: 0, y: 0, width: 10, height: 10 }}
        user={user}
      />,
    );

    expect(cursorHtml).toBe("");
    expect(cursorHtmlAgain).toBe("");
    expect(selectionHtml).toBe("");
    expect(selectionHtmlAgain).toBe("");

    const messages = warn.mock.calls.map((args) => String(args[0] ?? ""));
    expect(messages.filter((m) => m.includes("<LiveCursor>"))).toHaveLength(1);
    expect(
      messages.filter((m) => m.includes("<SelectionHighlight>")),
    ).toHaveLength(1);
    expect(messages[0]).toContain("PresenceLayer");

    warn.mockRestore();
  });

  it("hides the initial LiveCursor label after the configured timeout", async () => {
    vi.useFakeTimers();

    const container = document.createElement("div");
    const root = createRoot(container);
    const user = createUser("1", { name: "Grace" });

    await act(async () => {
      root.render(
        <InTestLayer>
          <LiveCursor
            labelVisibleMs={100}
            point={{ x: 12, y: 24 }}
            user={user}
          />
        </InTestLayer>,
      );
    });

    const cursor = container.querySelector(".awareness-live-cursor");
    expect(cursor?.className).toContain("awareness-live-cursor--label-visible");

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(cursor?.className).not.toContain(
      "awareness-live-cursor--label-visible",
    );

    await act(async () => {
      root.unmount();
    });
  });
});
