import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresenceContext,
  type PresenceContextValue,
} from "../providers/presence-context";
import type { PresenceUser } from "../types/presence";
import { useUpdateTyping } from "./use-update-presence";

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
): { container: HTMLDivElement; unmount: () => void } => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const Capture = (): null => {
    capture(useUpdateTyping());
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
});
