import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresenceContext,
  type PresenceContextValue,
} from "../providers/presence-context";
import type { PresenceUser } from "../types/presence";
import { usePeersInBlock } from "./use-peers-in-block";
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

const baseContext = (): PresenceContextValue => ({
  connectionState: "connected",
  self: createUser("self"),
  presence: new Map([["self", createUser("self")]]),
  others: [],
  recentActivity: [],
  updatePresence: () => {},
  connect: async () => {},
  disconnect: async () => {},
  adapter: null,
});

const renderHook = <T,>(
  hook: () => T,
  contextValue: PresenceContextValue | null,
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
      contextValue ? (
        <PresenceContext.Provider value={contextValue}>
          <Capture />
        </PresenceContext.Provider>
      ) : (
        <Capture />
      ),
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

const expectThrowsOutsideProvider = (
  hook: () => unknown,
  pattern: RegExp,
): void => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const Capture = (): null => {
    hook();
    return null;
  };

  expect(() => {
    act(() => {
      root.render(<Capture />);
    });
  }).toThrow(pattern);

  act(() => {
    root.unmount();
  });
  container.remove();
  consoleError.mockRestore();
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("usePeerCursors", () => {
  it("returns peers with a cursor, excluding self and offline by default", () => {
    const others: ReadonlyArray<PresenceUser> = [
      createUser("a", { cursor: { blockId: "intro", offset: 4 } }),
      createUser("b", { status: "active" }), // no cursor
      createUser("c", {
        status: "offline",
        cursor: { blockId: "intro", offset: 9 },
      }),
      createUser("d", {
        status: "idle",
        cursor: { blockId: "body", offset: 1 },
      }),
    ];
    const { result, unmount } = renderHook(() => usePeerCursors(), {
      ...baseContext(),
      others,
    });
    expect(result.current).toHaveLength(2);
    expect(result.current?.map((c) => c.user.userId)).toEqual(["a", "d"]);
    expect(result.current?.[0]?.cursor).toEqual({
      blockId: "intro",
      offset: 4,
    });
    unmount();
  });

  it("filters to a specific blockId when provided", () => {
    const others: ReadonlyArray<PresenceUser> = [
      createUser("a", { cursor: { blockId: "intro", offset: 4 } }),
      createUser("b", { cursor: { blockId: "body", offset: 1 } }),
    ];
    const { result, unmount } = renderHook(
      () => usePeerCursors({ blockId: "body" }),
      { ...baseContext(), others },
    );
    expect(result.current).toHaveLength(1);
    expect(result.current?.[0]?.user.userId).toBe("b");
    unmount();
  });

  it("includes offline peers when includeOffline is true", () => {
    const others: ReadonlyArray<PresenceUser> = [
      createUser("a", {
        status: "offline",
        cursor: { blockId: "intro", offset: 4 },
      }),
    ];
    const { result, unmount } = renderHook(
      () => usePeerCursors({ includeOffline: true }),
      { ...baseContext(), others },
    );
    expect(result.current).toHaveLength(1);
    unmount();
  });

  it("throws outside provider", () => {
    expectThrowsOutsideProvider(() => usePeerCursors(), /usePeerCursors/);
  });
});

describe("usePeersInBlock", () => {
  it("returns peers whose cursor or selection is in the block", () => {
    const others: ReadonlyArray<PresenceUser> = [
      createUser("a", { cursor: { blockId: "intro", offset: 4 } }),
      createUser("b", {
        selection: { blockId: "intro", from: 0, to: 4 },
      }),
      createUser("c", { cursor: { blockId: "body", offset: 1 } }),
    ];
    const { result, unmount } = renderHook(() => usePeersInBlock("intro"), {
      ...baseContext(),
      others,
    });
    expect(result.current?.map((u) => u.userId)).toEqual(["a", "b"]);
    unmount();
  });

  it("excludes offline peers by default", () => {
    const others: ReadonlyArray<PresenceUser> = [
      createUser("a", {
        status: "offline",
        cursor: { blockId: "intro", offset: 4 },
      }),
      createUser("b", { cursor: { blockId: "intro", offset: 10 } }),
    ];
    const { result, unmount } = renderHook(() => usePeersInBlock("intro"), {
      ...baseContext(),
      others,
    });
    expect(result.current?.map((u) => u.userId)).toEqual(["b"]);
    unmount();
  });

  it("includes self when includeSelf is true", () => {
    const self = createUser("self", {
      cursor: { blockId: "intro", offset: 0 },
    });
    const others: ReadonlyArray<PresenceUser> = [
      createUser("a", { cursor: { blockId: "intro", offset: 4 } }),
    ];
    const { result, unmount } = renderHook(
      () => usePeersInBlock("intro", { includeSelf: true }),
      {
        ...baseContext(),
        self,
        presence: new Map([
          ["self", self],
          ["a", others[0] as PresenceUser],
        ]),
        others,
      },
    );
    expect(result.current?.map((u) => u.userId).sort()).toEqual(["a", "self"]);
    unmount();
  });

  it("throws outside provider", () => {
    expectThrowsOutsideProvider(() => usePeersInBlock("x"), /usePeersInBlock/);
  });
});
