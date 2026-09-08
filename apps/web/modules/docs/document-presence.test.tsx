// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLLAB_RUNTIME } from "./collab-runtime-routing";
import type { CollabTarget } from "./collab-target";
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
const connectResolvers: Array<() => void> = [];
const createWebSocketAdapter = vi.fn((config: { url: string }) => ({
  ...fakeAdapter(),
  url: config.url,
  connect: vi.fn(
    () =>
      new Promise<void>((resolve) => {
        connectResolvers.push(resolve);
      }),
  ),
  disconnect,
}));
const createNoopAdapter = vi.fn(fakeAdapter);

type AuthListener = (
  event: string,
  session: { access_token?: string } | null,
) => void;

type SessionResult = {
  readonly data: {
    readonly session: { readonly access_token: string } | null;
  };
  readonly error: null;
};

let authListener: AuthListener | null = null;
let resolveGetSession: ((value: SessionResult) => void) | null = null;

vi.mock("@softmaple/awareness", async () => {
  const { useEffect } = await import("react");
  return {
    CollaborationBar: ({ state }: { state?: string }) =>
      createElement(
        "div",
        null,
        state === "error"
          ? "Presence unavailable"
          : state === "connecting"
            ? "Connecting…"
            : "Connected",
      ),
    PresenceLayer: ({ children }: { children: ReactNode }) => children,
    LiveCursor: () => null,
    SelectionHighlight: () => null,
    PresenceProvider: ({
      adapter,
      children,
    }: {
      adapter: { connect: () => Promise<unknown> };
      children: ReactNode;
    }) => {
      useEffect(() => {
        void adapter.connect();
      }, [adapter]);
      return children;
    },
    createNoopAdapter: () => createNoopAdapter(),
    createWebSocketAdapter: (config: { url: string }) =>
      createWebSocketAdapter(config),
    isDirectionalSelectionRange: () => false,
    isStableCursorPosition: () => false,
    useOthers: () => [],
    useSelf: () => null,
    usePresence: () => ({
      connectionState: "connected",
      presence: new Map(),
      updatePresence: vi.fn(),
    }),
    useUpdateCursor: () => () => undefined,
    useUpdateSelection: () => () => undefined,
  };
});

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
          replica: {
            getDocument: () => ({ schemaVersion: 1, blocks: [] }),
            subscribe: () => () => undefined,
          },
        });
      }, [onExternalBindingChange]);
      return null;
    },
  };
});

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () =>
        new Promise<SessionResult>((resolve) => {
          resolveGetSession = resolve;
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

/** Targets as a Server Component resolves them for one page load. */
const NITRO_TARGET: CollabTarget = {
  documentUrl: "ws://localhost:3000/collab/document",
  presenceUrl: "ws://localhost:3000/collab/presence",
  runtime: COLLAB_RUNTIME.Nitro,
};
const CLOUDFLARE_TARGET: CollabTarget = {
  documentUrl:
    "wss://example.workers.dev/collab/document?documentId=00000000-0000-4000-8000-000000000001",
  presenceUrl: "wss://example.workers.dev/collab/presence",
  runtime: COLLAB_RUNTIME.Cloudflare,
};

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
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    authListener = null;
    resolveGetSession = null;
    connectResolvers.length = 0;
    disconnect.mockClear();
    createWebSocketAdapter.mockClear();
    createNoopAdapter.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("ignores a stale getSession after a null-session auth event", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(DocumentPresence, {
          avatarUrl: null,
          collabTarget: NITRO_TARGET,
          documentId: "00000000-0000-4000-8000-000000000001",
          name: "Ada",
          presenceEnabled: true,
          userId: "user-1",
        }),
      );
      await Promise.resolve();
    });

    expect(authListener).toBeTypeOf("function");
    expect(resolveGetSession).toBeTypeOf("function");
    expect(createWebSocketAdapter).not.toHaveBeenCalled();

    await act(async () => {
      authListener?.("SIGNED_OUT", null);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Presence unavailable");
    expect(createWebSocketAdapter).not.toHaveBeenCalled();

    await act(async () => {
      resolveGetSession?.({
        data: {
          session: {
            access_token: "stale-token",
          },
        },
        error: null,
      });
      await Promise.resolve();
    });

    expect(createWebSocketAdapter).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Presence unavailable");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not expose a stale adapter as live after the target changes mid-connect", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const documentId = "00000000-0000-4000-8000-000000000001";
    const baseProps = {
      avatarUrl: null,
      documentId,
      name: "Ada",
      presenceEnabled: true,
      userId: "user-1",
    };

    await act(async () => {
      root.render(
        createElement(DocumentPresence, {
          ...baseProps,
          collabTarget: NITRO_TARGET,
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      resolveGetSession?.({
        data: { session: { access_token: "token-nitro" } },
        error: null,
      });
      await Promise.resolve();
    });

    expect(createWebSocketAdapter).toHaveBeenCalledTimes(1);
    expect(createWebSocketAdapter).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: NITRO_TARGET.presenceUrl }),
    );
    expect(container.textContent).not.toContain("Connecting…");

    // Switch to the cloudflare target before the new connect resolves.
    await act(async () => {
      root.render(
        createElement(DocumentPresence, {
          ...baseProps,
          collabTarget: CLOUDFLARE_TARGET,
        }),
      );
      await Promise.resolve();
    });

    // The nitro adapter must be disconnected and never shown as live for
    // the new (cloudflare) props while the new connection is in flight.
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Connecting…");

    await act(async () => {
      resolveGetSession?.({
        data: { session: { access_token: "token-cloudflare" } },
        error: null,
      });
      await Promise.resolve();
    });

    expect(createWebSocketAdapter).toHaveBeenCalledTimes(2);
    // Presence connects to the endpoint the server resolved for this page,
    // on the same runtime as the document socket — it derives no URL itself.
    expect(createWebSocketAdapter).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: CLOUDFLARE_TARGET.presenceUrl }),
    );
    expect(container.textContent).not.toContain("Connecting…");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not expose a stale adapter as live after userId changes mid-connect", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const baseProps = {
      avatarUrl: null,
      collabTarget: NITRO_TARGET,
      documentId: "00000000-0000-4000-8000-000000000001",
      name: "Ada",
      presenceEnabled: true,
    };

    await act(async () => {
      root.render(
        createElement(DocumentPresence, { ...baseProps, userId: "user-1" }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      resolveGetSession?.({
        data: { session: { access_token: "token-user-1" } },
        error: null,
      });
      await Promise.resolve();
    });

    expect(createWebSocketAdapter).toHaveBeenCalledTimes(1);
    expect(connectResolvers).toHaveLength(1);
    const resolveUser1Connect = connectResolvers[0];
    if (resolveUser1Connect === undefined) {
      throw new Error(
        "expected the user-1 adapter connect() to remain pending",
      );
    }
    expect(container.textContent).not.toContain("Connecting…");

    // Switch signed-in user before the in-flight user-1 connect resolves.
    await act(async () => {
      root.render(
        createElement(DocumentPresence, { ...baseProps, userId: "user-2" }),
      );
      await Promise.resolve();
    });

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Connecting…");

    // Resolving the stale user-1 connection must not restore it as live.
    await act(async () => {
      resolveUser1Connect();
      await Promise.resolve();
    });

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Connecting…");
    expect(container.textContent).not.toContain("Connected");

    await act(async () => {
      resolveGetSession?.({
        data: { session: { access_token: "token-user-2" } },
        error: null,
      });
      await Promise.resolve();
    });

    expect(createWebSocketAdapter).toHaveBeenCalledTimes(2);
    expect(connectResolvers).toHaveLength(2);
    const resolveUser2Connect = connectResolvers[1];
    if (resolveUser2Connect === undefined) {
      throw new Error(
        "expected the user-2 adapter connect() to remain pending",
      );
    }

    await act(async () => {
      resolveUser2Connect();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Connecting…");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
