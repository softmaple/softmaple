import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresenceContext,
  type PresenceContextValue,
} from "../providers/presence-context";
import { ACTIVITY_TYPE, type ActivityEvent } from "../types/events";
import type { PresenceUser } from "../types/presence";
import {
  useActivityByType,
  useRecentActivity,
  useUserActivity,
} from "./use-activity";
import { useConnectionState, useIsConnected } from "./use-connection";
import {
  useOther,
  useOthers,
  useOthersCount,
  useOthersFiltered,
} from "./use-others";
import { usePresence } from "./use-presence";
import { useSelf, useSelfSelector } from "./use-self";

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const createUser = (
  userId: string,
  overrides: Partial<Omit<PresenceUser, "userId">> = {},
): PresenceUser => ({
  userId,
  connectionId: overrides.connectionId ?? userId,
  name: `User ${userId}`,
  color: "#000",
  status: "active",
  lastActivityAt: 1000,
  lastSeenAt: 1000,
  clock: 0,
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

describe("usePresence", () => {
  it("returns the full context value", () => {
    const ctx = baseContext();
    const { result, unmount } = renderHook(() => usePresence(), ctx);
    expect(result.current).toBe(ctx);
    unmount();
  });

  it("throws outside provider", () => {
    expectThrowsOutsideProvider(() => usePresence(), /usePresence/);
  });
});

describe("useSelf / useSelfSelector", () => {
  it("useSelf returns context.self", () => {
    const ctx = baseContext();
    const { result, unmount } = renderHook(() => useSelf(), ctx);
    expect(result.current?.userId).toBe("self");
    unmount();
  });

  it("useSelf returns null when self is null", () => {
    const { result, unmount } = renderHook(() => useSelf(), {
      ...baseContext(),
      self: null,
    });
    expect(result.current).toBeNull();
    unmount();
  });

  it("useSelf throws outside provider", () => {
    expectThrowsOutsideProvider(() => useSelf(), /useSelf/);
  });

  it("useSelfSelector picks a property from self", () => {
    const ctx = baseContext();
    const { result, unmount } = renderHook(
      () => useSelfSelector((u) => u.name),
      ctx,
    );
    expect(result.current).toBe("User self");
    unmount();
  });

  it("useSelfSelector returns undefined when self is null", () => {
    const { result, unmount } = renderHook(
      () => useSelfSelector((u) => u.name),
      { ...baseContext(), self: null },
    );
    expect(result.current).toBeUndefined();
    unmount();
  });

  it("useSelfSelector throws outside provider", () => {
    expectThrowsOutsideProvider(
      () => useSelfSelector((u) => u.name),
      /useSelfSelector/,
    );
  });
});

describe("useOthers and friends", () => {
  it("useOthers returns context.others", () => {
    const others = [createUser("a"), createUser("b")];
    const { result, unmount } = renderHook(() => useOthers(), {
      ...baseContext(),
      others,
    });
    expect(result.current).toBe(others);
    unmount();
  });

  it("useOthersCount returns the count", () => {
    const others = [createUser("a"), createUser("b"), createUser("c")];
    const { result, unmount } = renderHook(() => useOthersCount(), {
      ...baseContext(),
      others,
    });
    expect(result.current).toBe(3);
    unmount();
  });

  it("useOther returns user by id, undefined for self", () => {
    const base = baseContext();
    const ctx: PresenceContextValue = {
      ...base,
      presence: new Map([
        ["self", base.self as PresenceUser],
        ["a", createUser("a")],
      ]),
    };

    const { result, unmount } = renderHook(() => useOther("a"), ctx);
    expect(result.current?.userId).toBe("a");
    unmount();

    const { result: selfResult, unmount: unmount2 } = renderHook(
      () => useOther("self"),
      ctx,
    );
    expect(selfResult.current).toBeUndefined();
    unmount2();

    const { result: missingResult, unmount: unmount3 } = renderHook(
      () => useOther("missing"),
      ctx,
    );
    expect(missingResult.current).toBeUndefined();
    unmount3();
  });

  it("useOthersFiltered applies the predicate", () => {
    const others = [
      createUser("a", { status: "active" }),
      createUser("b", { status: "idle" }),
      createUser("c", { status: "offline" }),
    ];
    const { result, unmount } = renderHook(
      () => useOthersFiltered((u) => u.status === "active"),
      { ...baseContext(), others },
    );
    expect(result.current).toHaveLength(1);
    expect(result.current?.[0]?.userId).toBe("a");
    unmount();
  });

  it("each useOthers* hook throws outside provider", () => {
    expectThrowsOutsideProvider(() => useOthers(), /useOthers/);
    expectThrowsOutsideProvider(() => useOthersCount(), /useOthersCount/);
    expectThrowsOutsideProvider(() => useOther("a"), /useOther/);
    expectThrowsOutsideProvider(
      () => useOthersFiltered(() => true),
      /useOthersFiltered/,
    );
  });
});

describe("useConnectionState / useIsConnected", () => {
  it("useConnectionState returns the connection state", () => {
    const { result, unmount } = renderHook(() => useConnectionState(), {
      ...baseContext(),
      connectionState: "reconnecting",
    });
    expect(result.current).toBe("reconnecting");
    unmount();
  });

  it("useIsConnected reflects connected state", () => {
    const { result, unmount } = renderHook(() => useIsConnected(), {
      ...baseContext(),
      connectionState: "connected",
    });
    expect(result.current).toBe(true);
    unmount();

    const { result: r2, unmount: u2 } = renderHook(() => useIsConnected(), {
      ...baseContext(),
      connectionState: "disconnected",
    });
    expect(r2.current).toBe(false);
    u2();
  });

  it("each connection hook throws outside provider", () => {
    expectThrowsOutsideProvider(
      () => useConnectionState(),
      /useConnectionState/,
    );
    expectThrowsOutsideProvider(() => useIsConnected(), /useIsConnected/);
  });
});

describe("activity hooks", () => {
  const sample: ReadonlyArray<ActivityEvent> = [
    {
      userId: "a",
      timestamp: 1,
      type: ACTIVITY_TYPE.JOIN,
    },
    {
      userId: "b",
      timestamp: 2,
      type: ACTIVITY_TYPE.JOIN,
    },
    {
      userId: "a",
      timestamp: 3,
      type: ACTIVITY_TYPE.TYPING,
      data: { type: ACTIVITY_TYPE.TYPING, isTyping: true },
    },
  ];

  it("useRecentActivity returns recentActivity", () => {
    const { result, unmount } = renderHook(() => useRecentActivity(), {
      ...baseContext(),
      recentActivity: sample,
    });
    expect(result.current).toBe(sample);
    unmount();
  });

  it("useUserActivity filters by userId", () => {
    const { result, unmount } = renderHook(() => useUserActivity("a"), {
      ...baseContext(),
      recentActivity: sample,
    });
    expect(result.current).toHaveLength(2);
    expect(result.current?.every((e) => e.userId === "a")).toBe(true);
    unmount();
  });

  it("useActivityByType filters by type", () => {
    const { result, unmount } = renderHook(
      () => useActivityByType(ACTIVITY_TYPE.JOIN),
      { ...baseContext(), recentActivity: sample },
    );
    expect(result.current).toHaveLength(2);
    expect(result.current?.every((e) => e.type === ACTIVITY_TYPE.JOIN)).toBe(
      true,
    );
    unmount();
  });

  it("each activity hook throws outside provider", () => {
    expectThrowsOutsideProvider(() => useRecentActivity(), /useRecentActivity/);
    expectThrowsOutsideProvider(() => useUserActivity("a"), /useUserActivity/);
    expectThrowsOutsideProvider(
      () => useActivityByType(ACTIVITY_TYPE.JOIN),
      /useActivityByType/,
    );
  });
});
