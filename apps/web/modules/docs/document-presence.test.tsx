// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentPresence } from "./document-presence";
import { domPointAtOffset } from "./document-presence-dom";

const disconnect = vi.fn(async () => undefined);
const fakeAdapter = () => ({
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  getConnectionState: () => "disconnected" as const,
  getPresence: () => new Map(),
  getSelf: () => null,
  subscribe: () => () => undefined,
  updatePresence: () => undefined,
});
const createWebSocketAdapter = vi.fn(() => ({
  ...fakeAdapter(),
  disconnect,
}));
const createNoopAdapter = vi.fn(fakeAdapter);

type AuthListener = (
  event: string,
  session: { access_token?: string } | null,
) => void;

let authListener: AuthListener | null = null;

vi.mock("@softmaple/awareness", () => ({
  PresenceProvider: ({ children }: { children: ReactNode }) => children,
  createNoopAdapter: () => createNoopAdapter(),
  createWebSocketAdapter: () => createWebSocketAdapter(),
  isDirectionalSelectionRange: () => false,
  isStableCursorPosition: () => false,
  useOthers: () => [],
  usePresence: () => ({
    connectionState: "connected",
    presence: new Map(),
    updatePresence: vi.fn(),
  }),
  useUpdateCursor: () => () => undefined,
  useUpdateSelection: () => () => undefined,
}));

vi.mock("@softmaple/ui/components/avatar", () => ({
  Avatar: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  AvatarFallback: ({ children }: { children: ReactNode }) =>
    createElement("span", null, children),
  AvatarImage: () => null,
}));

vi.mock("@/modules/docs/doc-editor", async () => {
  const { useEffect } = await import("react");
  return {
    DocEditor: ({
      onExternalBindingChange,
    }: {
      onExternalBindingChange?: (binding: unknown) => void;
    }) => {
      useEffect(() => {
        onExternalBindingChange?.({
          editor: {
            getElementByKey: () => null,
            registerUpdateListener: () => () => undefined,
          },
          getBlockIndex: () => ({ blockIdToNodeKey: new Map() }),
        });
      }, [onExternalBindingChange]);
      return null;
    },
  };
});

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: {
            access_token: "initial-token",
          },
        },
        error: null,
      }),
      onAuthStateChange: (listener: AuthListener) => {
        authListener = listener;
        return {
          data: {
            subscription: {
              unsubscribe: vi.fn(),
            },
          },
        };
      },
    },
  }),
}));

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

describe("remote presence DOM mapping", () => {
  it("maps a block offset through nested inline nodes", () => {
    const block = document.createElement("p");
    block.append("abc");
    const mark = document.createElement("strong");
    mark.append("def");
    block.append(mark, "ghi");

    const point = domPointAtOffset(block, 5);

    expect(point.node.textContent).toBe("def");
    expect(point.offset).toBe(2);
  });

  it("clamps an offset beyond the block to its final text node", () => {
    const block = document.createElement("p");
    block.append("final");
    const point = domPointAtOffset(block, 99);
    expect(point.node.textContent).toBe("final");
    expect(point.offset).toBe(5);
  });
});

describe("DocumentPresence auth lifecycle", () => {
  beforeEach(() => {
    authListener = null;
    disconnect.mockClear();
    createWebSocketAdapter.mockClear();
    createNoopAdapter.mockClear();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("clears the live adapter and shows unavailable on a null-session auth event", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(DocumentPresence, {
          avatarUrl: null,
          documentId: "00000000-0000-4000-8000-000000000001",
          name: "Ada",
          presenceEnabled: true,
          userId: "user-1",
        }),
      );
      await Promise.resolve();
    });

    expect(createWebSocketAdapter).toHaveBeenCalled();
    expect(authListener).toBeTypeOf("function");

    await act(async () => {
      authListener?.("SIGNED_OUT", null);
      await Promise.resolve();
    });

    expect(disconnect).toHaveBeenCalled();
    expect(container.textContent).toContain("Presence session is unavailable.");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
