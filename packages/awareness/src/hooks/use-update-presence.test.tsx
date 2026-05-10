import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresenceContext,
  type PresenceContextValue,
} from "../providers/presence-context";
import type { CursorPosition, PresenceUser } from "../types/presence";
import { useUpdateCursor, useUpdateTyping } from "./use-update-presence";

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const createSelf = (overrides: Partial<PresenceUser> = {}): PresenceUser => ({
  userId: "self",
  name: "Self",
  color: "#2563eb",
  status: "active",
  lastActiveAt: 1000,
  ...overrides,
});

const createContextValue = (
  self: PresenceUser | null,
  updatePresence: PresenceContextValue["updatePresence"],
): PresenceContextValue => ({
  connectionState: "connected",
  self,
  presence: new Map(),
  others: [],
  recentActivity: [],
  updatePresence,
  connect: async () => {},
  disconnect: async () => {},
  adapter: null,
});

const renderWithContext = (
  contextValue: PresenceContextValue,
  capture: (typing: (isTyping: boolean) => void) => void,
  idleMs?: number,
): { container: HTMLDivElement; unmount: () => void } => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const Capture = (): null => {
    capture(useUpdateTyping(idleMs));
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
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const renderCursorWithContext = (
  contextValue: PresenceContextValue,
  capture: (update: (cursor: CursorPosition | undefined) => void) => void,
  throttleMs?: number,
): { unmount: () => void } => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const Capture = (): null => {
    capture(useUpdateCursor(throttleMs));
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
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe("useUpdateTyping", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("calls updatePresence with isTyping=true and preserves existing meta", () => {
    const updatePresence = vi.fn();
    const self = createSelf({ meta: { customField: "keep-me" } });
    let typing: ((isTyping: boolean) => void) | null = null;

    const { unmount } = renderWithContext(
      createContextValue(self, updatePresence),
      (fn) => {
        typing = fn;
      },
    );

    expect(typing).not.toBeNull();
    act(() => {
      typing?.(true);
    });

    expect(updatePresence).toHaveBeenCalledWith({
      meta: { customField: "keep-me", isTyping: true },
    });

    unmount();
  });

  it("calls updatePresence with isTyping=false", () => {
    const updatePresence = vi.fn();
    let typing: ((isTyping: boolean) => void) | null = null;

    const { unmount } = renderWithContext(
      createContextValue(createSelf(), updatePresence),
      (fn) => {
        typing = fn;
      },
    );

    act(() => {
      typing?.(false);
    });

    expect(updatePresence).toHaveBeenCalledWith({
      meta: { isTyping: false },
    });

    unmount();
  });

  it("works when self.meta is undefined", () => {
    const updatePresence = vi.fn();
    let typing: ((isTyping: boolean) => void) | null = null;

    const { unmount } = renderWithContext(
      createContextValue(createSelf(), updatePresence),
      (fn) => {
        typing = fn;
      },
    );

    act(() => {
      typing?.(true);
    });

    expect(updatePresence).toHaveBeenCalledWith({
      meta: { isTyping: true },
    });

    unmount();
  });

  it("throws when used outside PresenceProvider", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    const Capture = (): null => {
      useUpdateTyping();
      return null;
    };

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => {
      act(() => {
        root.render(<Capture />);
      });
    }).toThrow(/useUpdateTyping/);

    act(() => {
      root.unmount();
    });
    container.remove();
    consoleError.mockRestore();
  });

  it("collapses repeated true calls into one update", () => {
    const updatePresence = vi.fn();
    let typing: ((isTyping: boolean) => void) | null = null;

    const { unmount } = renderWithContext(
      createContextValue(createSelf(), updatePresence),
      (fn) => {
        typing = fn;
      },
    );

    act(() => {
      typing?.(true);
      typing?.(true);
      typing?.(true);
    });

    expect(updatePresence).toHaveBeenCalledTimes(1);
    expect(updatePresence).toHaveBeenCalledWith({ meta: { isTyping: true } });

    unmount();
  });

  it("auto-sends isTyping=false after idleMs of inactivity", () => {
    vi.useFakeTimers();
    const updatePresence = vi.fn();
    let typing: ((isTyping: boolean) => void) | null = null;

    const { unmount } = renderWithContext(
      createContextValue(createSelf(), updatePresence),
      (fn) => {
        typing = fn;
      },
      100,
    );

    act(() => {
      typing?.(true);
    });
    expect(updatePresence).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(updatePresence).toHaveBeenCalledTimes(2);
    expect(updatePresence).toHaveBeenLastCalledWith({
      meta: { isTyping: false },
    });

    unmount();
    vi.useRealTimers();
  });

  it("manual false cancels the pending idle timer", () => {
    vi.useFakeTimers();
    const updatePresence = vi.fn();
    let typing: ((isTyping: boolean) => void) | null = null;

    const { unmount } = renderWithContext(
      createContextValue(createSelf(), updatePresence),
      (fn) => {
        typing = fn;
      },
      500,
    );

    act(() => {
      typing?.(true);
      typing?.(false);
    });

    expect(updatePresence).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(updatePresence).toHaveBeenCalledTimes(2);

    unmount();
    vi.useRealTimers();
  });
});

describe("useUpdateCursor", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("sends the first call immediately", () => {
    vi.useFakeTimers();
    const updatePresence = vi.fn();
    let updateCursor: ((c: CursorPosition | undefined) => void) | null = null;

    const { unmount } = renderCursorWithContext(
      createContextValue(createSelf(), updatePresence),
      (fn) => {
        updateCursor = fn;
      },
      50,
    );

    act(() => {
      updateCursor?.({ blockId: "b", offset: 1 });
    });

    expect(updatePresence).toHaveBeenCalledTimes(1);
    expect(updatePresence).toHaveBeenCalledWith({
      cursor: { blockId: "b", offset: 1 },
    });

    unmount();
  });

  it("collapses calls within the throttle window into a single trailing send", () => {
    vi.useFakeTimers();
    const updatePresence = vi.fn();
    let updateCursor: ((c: CursorPosition | undefined) => void) | null = null;

    const { unmount } = renderCursorWithContext(
      createContextValue(createSelf(), updatePresence),
      (fn) => {
        updateCursor = fn;
      },
      50,
    );

    act(() => {
      updateCursor?.({ blockId: "b", offset: 1 });
    });
    expect(updatePresence).toHaveBeenCalledTimes(1);

    act(() => {
      updateCursor?.({ blockId: "b", offset: 2 });
      updateCursor?.({ blockId: "b", offset: 3 });
      updateCursor?.({ blockId: "b", offset: 4 });
    });
    expect(updatePresence).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(updatePresence).toHaveBeenCalledTimes(2);
    expect(updatePresence).toHaveBeenLastCalledWith({
      cursor: { blockId: "b", offset: 4 },
    });

    unmount();
  });

  it("opts out of throttling when throttleMs=0", () => {
    const updatePresence = vi.fn();
    let updateCursor: ((c: CursorPosition | undefined) => void) | null = null;

    const { unmount } = renderCursorWithContext(
      createContextValue(createSelf(), updatePresence),
      (fn) => {
        updateCursor = fn;
      },
      0,
    );

    act(() => {
      updateCursor?.({ blockId: "b", offset: 1 });
      updateCursor?.({ blockId: "b", offset: 2 });
      updateCursor?.({ blockId: "b", offset: 3 });
    });

    expect(updatePresence).toHaveBeenCalledTimes(3);

    unmount();
  });
});
