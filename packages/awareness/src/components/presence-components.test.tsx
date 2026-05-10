import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_TYPE } from "../constants/presence-events";
import type { ActivityEvent } from "../types/events";
import type { PresenceUser } from "../types/presence";
import { ActivityIndicator } from "./activity-indicator";
import { LiveCursor } from "./live-cursor";
import { PresenceAvatar } from "./presence-avatar";
import { PresenceBar } from "./presence-bar";
import { SelectionHighlight } from "./selection-highlight";

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
      <LiveCursor point={{ x: 12, y: 24 }} user={user} />,
    );
    const selectionHtml = renderToStaticMarkup(
      <SelectionHighlight
        rect={{ x: 4, y: 8, width: 120, height: 20 }}
        selectedText="shared note"
        showLabel
        user={user}
      />,
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

  it("hides the initial LiveCursor label after the configured timeout", async () => {
    vi.useFakeTimers();

    const container = document.createElement("div");
    const root = createRoot(container);
    const user = createUser("1", { name: "Grace" });

    await act(async () => {
      root.render(
        <LiveCursor
          labelVisibleMs={100}
          point={{ x: 12, y: 24 }}
          user={user}
        />,
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
