import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresenceContext,
  type PresenceContextValue,
} from "../providers/presence-context";
import type { PresenceResolver } from "../resolver";
import type { PresenceUser } from "../types/presence";
import { useOther } from "./use-others";
import { usePeerCursors } from "./use-presence-cursors";

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
  color: "#000",
  status: "active",
  lastActiveAt: 1000,
  ...overrides,
});

const baseContext = (
  others: ReadonlyArray<PresenceUser>,
  resolver?: PresenceResolver,
): PresenceContextValue => ({
  connectionState: "connected",
  self: createUser("self"),
  presence: new Map([
    ["self", createUser("self")],
    ...others.map((user) => [user.userId, user] as const),
  ]),
  others,
  recentActivity: [],
  updatePresence: () => {},
  updatePointer: () => {},
  remapRemotePositions: () => {},
  resolver,
  connect: async () => {},
  disconnect: async () => {},
  adapter: null,
});

const renderHook = <T,>(
  hook: () => T,
  contextValue: PresenceContextValue,
): { result: { current: T | null }; unmount: () => void } => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const result: { current: T | null } = { current: null };

  const Capture = (): null => {
    result.current = hook();
    return null;
  };

  act(() => {
    root.render(
      <PresenceContext.Provider value={contextValue}>
        <Capture />
      </PresenceContext.Provider>,
    );
  });

  return {
    result,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("resolved peer positions", () => {
  it("resolves anchored cursors before returning peer cursors", () => {
    const resolver: PresenceResolver = {
      resolveCursor: vi.fn(() => ({ blockId: "body", offset: 42 })),
    };
    const peer = createUser("peer", {
      cursor: { blockId: "body", offset: 6, anchor: "anchor" },
    });

    const { result, unmount } = renderHook(
      () => usePeerCursors(),
      baseContext([peer], resolver),
    );

    expect(resolver.resolveCursor).toHaveBeenCalledWith(peer.cursor, "peer");
    expect(result.current).toEqual([
      {
        user: { ...peer, cursor: { blockId: "body", offset: 42 } },
        cursor: { blockId: "body", offset: 42 },
      },
    ]);
    unmount();
  });

  it("suppresses a peer when resolver returns null", () => {
    const resolver: PresenceResolver = {
      resolveCursor: vi.fn(() => null),
    };
    const peer = createUser("peer", {
      cursor: { blockId: "body", offset: 6, anchor: "gone" },
    });

    const { result, unmount } = renderHook(
      () => usePeerCursors(),
      baseContext([peer], resolver),
    );

    expect(result.current).toEqual([]);
    unmount();
  });

  it("passes offset-only cursors through when a resolver is configured", () => {
    const resolver: PresenceResolver = {
      resolveCursor: vi.fn(() => ({ blockId: "body", offset: 99 })),
    };
    const peer = createUser("peer", {
      cursor: { blockId: "body", offset: 6 },
    });

    const { result, unmount } = renderHook(
      () => usePeerCursors(),
      baseContext([peer], resolver),
    );

    expect(resolver.resolveCursor).not.toHaveBeenCalled();
    expect(result.current?.[0]?.cursor).toEqual({ blockId: "body", offset: 6 });
    unmount();
  });

  it("keeps pointer presence untouched in useOther", () => {
    const peer = createUser("peer", {
      pointer: { x: 24, y: 48, space: "document" },
    });

    const { result, unmount } = renderHook(
      () => useOther("peer"),
      baseContext([peer]),
    );

    expect(result.current?.pointer).toEqual({
      x: 24,
      y: 48,
      space: "document",
    });
    unmount();
  });
});
