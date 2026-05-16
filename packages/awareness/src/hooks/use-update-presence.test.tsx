import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresenceContext,
  type PresenceContextValue,
} from "../providers/presence-context";
import type {
  CursorPosition,
  PointerPosition,
  PresenceUser,
  SelectionRange,
} from "../types/presence";
import {
  useUpdateCursor,
  useUpdatePointer,
  useUpdatePresence,
  useUpdateSelection,
  useUpdateTyping,
} from "./use-update-presence";

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
  updatePointer: (pointer) => updatePresence({ pointer: pointer ?? undefined }),
  remapRemotePositions: () => {},
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
  capture: (
    update: (cursor: CursorPosition | null | undefined) => void,
  ) => void,
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

const renderPointerWithContext = (
  contextValue: PresenceContextValue,
  capture: (
    update: (pointer: PointerPosition | null | undefined) => void,
  ) => void,
  throttleMs?: number,
): { unmount: () => void } => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const Capture = (): null => {
    capture(useUpdatePointer(throttleMs));
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

  it("normalizes null clear to undefined", () => {
    const updatePresence = vi.fn();
    let updateCursor: ((c: CursorPosition | null | undefined) => void) | null =
      null;

    const { unmount } = renderCursorWithContext(
      createContextValue(createSelf(), updatePresence),
      (fn) => {
        updateCursor = fn;
      },
      0,
    );

    act(() => {
      updateCursor?.(null);
    });

    expect(updatePresence).toHaveBeenCalledWith({ cursor: undefined });

    unmount();
  });

  it("cancels a pending trailing send when throttleMs changes mid-session", () => {
    vi.useFakeTimers();
    const updatePresence = vi.fn();
    let updateCursor: ((c: CursorPosition | undefined) => void) | null = null;

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    const Capture = ({ throttleMs }: { throttleMs: number }): null => {
      updateCursor = useUpdateCursor(throttleMs);
      return null;
    };

    act(() => {
      root.render(
        <PresenceContext.Provider
          value={createContextValue(createSelf(), updatePresence)}
        >
          <Capture throttleMs={50} />
        </PresenceContext.Provider>,
      );
    });

    // Leading-edge fires immediately, then a trailing send is queued.
    act(() => {
      updateCursor?.({ blockId: "b", offset: 1 });
      updateCursor?.({ blockId: "b", offset: 2 });
    });
    expect(updatePresence).toHaveBeenCalledTimes(1);

    // Flip throttleMs to 0 BEFORE the trailing timer would have fired. The
    // queued send must be cancelled so the consumer's "no throttling"
    // intent is honored — no stale send under the new semantics.
    act(() => {
      root.render(
        <PresenceContext.Provider
          value={createContextValue(createSelf(), updatePresence)}
        >
          <Capture throttleMs={0} />
        </PresenceContext.Provider>,
      );
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(updatePresence).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
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

  it("throws when used outside PresenceProvider", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const Capture = (): null => {
      useUpdateCursor();
      return null;
    };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    expect(() => {
      act(() => {
        root.render(<Capture />);
      });
    }).toThrow(/useUpdateCursor/);
    act(() => {
      root.unmount();
    });
    container.remove();
    consoleError.mockRestore();
  });
});

describe("useUpdatePresence and useUpdateSelection", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("useUpdatePresence returns context.updatePresence", () => {
    const updatePresence = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let captured: PresenceContextValue["updatePresence"] | null = null;
    const Capture = (): null => {
      captured = useUpdatePresence();
      return null;
    };
    act(() => {
      root.render(
        <PresenceContext.Provider
          value={createContextValue(createSelf(), updatePresence)}
        >
          <Capture />
        </PresenceContext.Provider>,
      );
    });
    expect(captured).toBe(updatePresence);
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("useUpdatePresence throws outside provider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const Capture = (): null => {
      useUpdatePresence();
      return null;
    };
    expect(() => {
      act(() => {
        root.render(<Capture />);
      });
    }).toThrow(/useUpdatePresence/);
    act(() => {
      root.unmount();
    });
    container.remove();
    consoleError.mockRestore();
  });

  it("useUpdateSelection forwards selection updates (throttle bypassed)", () => {
    const updatePresence = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let captured:
      | ((selection: SelectionRange | null | undefined) => void)
      | null = null;
    const Capture = (): null => {
      captured = useUpdateSelection(0);
      return null;
    };
    act(() => {
      root.render(
        <PresenceContext.Provider
          value={createContextValue(createSelf(), updatePresence)}
        >
          <Capture />
        </PresenceContext.Provider>,
      );
    });

    act(() => {
      captured?.({ blockId: "b1", from: 0, to: 5 });
    });
    expect(updatePresence).toHaveBeenCalledWith({
      selection: { blockId: "b1", from: 0, to: 5 },
    });

    act(() => {
      captured?.(undefined);
    });
    expect(updatePresence).toHaveBeenCalledWith({ selection: undefined });

    act(() => {
      captured?.(null);
    });
    // null is normalized to undefined on the wire so peers see an explicit
    // "no selection" rather than "key omitted".
    expect(updatePresence).toHaveBeenLastCalledWith({ selection: undefined });

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("useUpdateSelection collapses drag-select calls into a single trailing send", () => {
    vi.useFakeTimers();
    const updatePresence = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let captured:
      | ((selection: SelectionRange | null | undefined) => void)
      | null = null;
    const Capture = (): null => {
      captured = useUpdateSelection(50);
      return null;
    };
    act(() => {
      root.render(
        <PresenceContext.Provider
          value={createContextValue(createSelf(), updatePresence)}
        >
          <Capture />
        </PresenceContext.Provider>,
      );
    });

    act(() => {
      captured?.({ blockId: "b1", from: 0, to: 1 });
    });
    expect(updatePresence).toHaveBeenCalledTimes(1);

    act(() => {
      captured?.({ blockId: "b1", from: 0, to: 2 });
      captured?.({ blockId: "b1", from: 0, to: 3 });
      captured?.({ blockId: "b1", from: 0, to: 4 });
    });
    expect(updatePresence).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(updatePresence).toHaveBeenCalledTimes(2);
    expect(updatePresence).toHaveBeenLastCalledWith({
      selection: { blockId: "b1", from: 0, to: 4 },
    });

    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it("useUpdateSelection throws outside provider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const Capture = (): null => {
      useUpdateSelection();
      return null;
    };
    expect(() => {
      act(() => {
        root.render(<Capture />);
      });
    }).toThrow(/useUpdateSelection/);
    act(() => {
      root.unmount();
    });
    container.remove();
    consoleError.mockRestore();
  });
});

describe("useUpdatePointer", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("collapses rapid pointer calls into a single trailing update", () => {
    vi.useFakeTimers();
    const updatePresence = vi.fn();
    let updatePointer:
      | ((pointer: PointerPosition | null | undefined) => void)
      | null = null;

    const { unmount } = renderPointerWithContext(
      createContextValue(createSelf(), updatePresence),
      (fn) => {
        updatePointer = fn;
      },
      32,
    );

    act(() => {
      updatePointer?.({ x: 1, y: 2, space: "viewport" });
    });
    expect(updatePresence).toHaveBeenCalledTimes(1);

    act(() => {
      updatePointer?.({ x: 3, y: 4, space: "viewport" });
      updatePointer?.({ x: 5, y: 6, space: "viewport" });
    });
    expect(updatePresence).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(40);
    });

    expect(updatePresence).toHaveBeenCalledTimes(2);
    expect(updatePresence).toHaveBeenLastCalledWith({
      pointer: { x: 5, y: 6, space: "viewport" },
    });

    unmount();
  });

  it("clears pointer when passed null", () => {
    const updatePresence = vi.fn();
    let updatePointer:
      | ((pointer: PointerPosition | null | undefined) => void)
      | null = null;

    const { unmount } = renderPointerWithContext(
      createContextValue(createSelf(), updatePresence),
      (fn) => {
        updatePointer = fn;
      },
      0,
    );

    act(() => {
      updatePointer?.(null);
    });

    expect(updatePresence).toHaveBeenCalledWith({ pointer: undefined });
    unmount();
  });

  it("sends pointer payloads through the presence update path", () => {
    const updatePresence = vi.fn();
    let updatePointer:
      | ((pointer: PointerPosition | null | undefined) => void)
      | null = null;

    const { unmount } = renderPointerWithContext(
      createContextValue(createSelf(), updatePresence),
      (fn) => {
        updatePointer = fn;
      },
      0,
    );

    act(() => {
      updatePointer?.({ x: 10, y: 12, space: "document" });
    });

    expect(updatePresence).toHaveBeenCalledWith({
      pointer: { x: 10, y: 12, space: "document" },
    });
    unmount();
  });
});
