/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOTSTRAP_BATCH_ID,
  BOOTSTRAP_BLOCK_ID,
  createBlockReplica,
} from "@softmaple/block-model";
import { isDocumentEditable } from "@/modules/docs/document-editability";
import { createSaveCoordinator } from "@/modules/docs/document-save-coordinator";
import {
  useDocumentSession,
  type DocumentSessionState,
} from "@/modules/docs/use-document-session";

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: {
            access_token: "token",
            user: { id: "user-private" },
          },
        },
        error: null,
      }),
    },
  }),
}));

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const renderDocumentSession = ({
  documentId,
  isShared,
}: {
  readonly documentId: string;
  readonly isShared: boolean;
}): {
  readonly result: { current: DocumentSessionState };
  readonly unmount: () => void;
} => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const result: { current: DocumentSessionState } = {
    current: {
      collaborationStatus: "disabled",
      editable: false,
      error: null,
      flush: async () => undefined,
      onBindingChange: () => {},
      replica: null,
      saveStatus: "idle",
      status: "saved",
    },
  };

  const Capture = (): null => {
    result.current = useDocumentSession({
      documentId,
      isShared,
      permission: "editor",
      sessionMode: "authenticated",
    });
    return null;
  };

  act(() => {
    root.render(createElement(Capture));
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

describe("document session behavior contracts", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal(
      "WebSocket",
      vi.fn(() => {
        throw new Error("WebSocket should not open for private documents");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("should keep permission-based editability while a save is in flight", async () => {
    const editable = isDocumentEditable({
      permission: "editor",
      sessionMode: "authenticated",
    });
    expect(editable).toBe(true);

    let release: (() => void) | undefined;
    const coordinator = createSaveCoordinator(() => undefined);
    coordinator.requestSave(async () => {
      await new Promise<"empty">((resolve) => {
        release = () => resolve("empty");
      });
      return "empty";
    });

    // Saving must not flip editability.
    expect(
      isDocumentEditable({
        permission: "editor",
        sessionMode: "authenticated",
      }),
    ).toBe(true);
    release?.();
  });

  it("should persist edits made while a prior save is still running", async () => {
    const pending = new Map<string, string>();
    const persisted: string[] = [];
    const coordinator = createSaveCoordinator(() => undefined);

    let releaseFirst: (() => void) | undefined;
    const persist = async (): Promise<"ack" | "empty"> => {
      const snapshot = [...pending.keys()];
      if (snapshot.length === 0) return "empty";
      if (persisted.length === 0) {
        await new Promise<"ack">((resolve) => {
          releaseFirst = () => resolve("ack");
        });
      }
      for (const key of snapshot) {
        persisted.push(key);
        pending.delete(key);
      }
      return pending.size === 0 ? "empty" : "ack";
    };

    pending.set("edit-1", "A");
    coordinator.requestSave(persist);
    pending.set("edit-2", "B");
    coordinator.requestSave(persist);

    await vi.waitFor(() => {
      expect(releaseFirst).toBeTypeOf("function");
    });
    releaseFirst?.();
    await vi.waitFor(() => {
      expect(persisted).toEqual(["edit-1", "edit-2"]);
    });
  });

  it("should seed shared collaboration from existing private replica content", () => {
    const privateReplica = createBlockReplica("private-session");
    privateReplica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "ABCDE");
    });
    privateReplica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 5, "FG");
    });

    const sharedReplica = createBlockReplica("shared-session");
    const exported = privateReplica
      .exportEvents()
      .filter((batch) => batch.batchId !== BOOTSTRAP_BATCH_ID);
    sharedReplica.applyRemoteEvents(exported);

    // Content survives the private → shared handoff when history is flushed
    // before the collaboration socket connects.
    expect(sharedReplica.getDocument().blocks[0]?.text).toBe("ABCDEFG");
  });

  it("should load and save a private document without opening a WebSocket", async () => {
    const seedReplica = createBlockReplica("private-http");
    const seedBatch = seedReplica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "solo");
    });
    if (seedBatch === null) throw new Error("expected batch");

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/collab/document-history")) {
          return new Response(
            JSON.stringify({
              batches: [seedBatch],
              nextCursor: "1",
              complete: true,
            }),
            { status: 200 },
          );
        }
        if (url.includes("/collab/document-events")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            readonly batches?: ReadonlyArray<{ readonly batchId: string }>;
          };
          return new Response(
            JSON.stringify({
              batchIds: (body.batches ?? []).map((batch) => batch.batchId),
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const documentId = "00000000-0000-4000-8000-000000000099";
    const { result, unmount } = renderDocumentSession({
      documentId,
      isShared: false,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(result.current.replica).not.toBeNull();
    });

    expect(result.current.collaborationStatus).toBe("disabled");
    expect(result.current.replica?.getDocument().blocks[0]?.text).toBe("solo");
    expect(WebSocket).not.toHaveBeenCalled();

    const localBatch = result.current.replica?.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 4, "!");
    });
    if (localBatch === null || localBatch === undefined) {
      throw new Error("expected local batch");
    }

    await act(async () => {
      await result.current.flush();
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      new URL("/collab/document-events", window.location.origin).toString(),
    );
    expect(WebSocket).not.toHaveBeenCalled();

    unmount();
  });
});
