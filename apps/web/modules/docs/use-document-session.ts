"use client";

import type { LexicalBinding } from "@softmaple/binding-lexical";
import {
  createBlockReplica,
  type BlockReplica,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import {
  COLLAB_ACCESS_MODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  parseServerCollabMessage,
} from "@softmaple/collab-protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closeCollabClientSocket,
  COLLAB_CLIENT_CLOSE_CODE,
} from "@/modules/docs/collab-client-close";
import {
  acknowledgePendingBatches,
  addPendingBatches,
  loadPendingBatches,
} from "@/modules/docs/collab-pending-store";
import {
  isDocumentEditable,
  type DocumentPermission,
  type DocumentSessionMode,
} from "@/modules/docs/document-editability";
import {
  createSaveCoordinator,
  deriveDocumentUiStatus,
  type CollaborationStatus,
  type DocumentUiStatus,
  type SaveStatus,
} from "@/modules/docs/document-save-coordinator";
import {
  loadPrivateDocumentHistory,
  persistPrivateDocumentEvents,
} from "@/modules/docs/private-document-api";
import { createClient } from "@/utils/supabase/client";

export type {
  CollaborationStatus,
  DocumentUiStatus,
  SaveStatus,
} from "@/modules/docs/document-save-coordinator";

export type CollabDocumentStatus = DocumentUiStatus;
export type CollabSessionMode = DocumentSessionMode;

export interface DocumentSessionState {
  readonly collaborationStatus: CollaborationStatus;
  readonly editable: boolean;
  readonly error: Error | null;
  readonly flush: () => Promise<void>;
  readonly onBindingChange: (binding: LexicalBinding | null) => void;
  readonly replica: BlockReplica | null;
  readonly saveStatus: SaveStatus;
  readonly status: DocumentUiStatus;
}

/** @deprecated Prefer DocumentSessionState; kept for existing call sites. */
export type CollabDocumentState = DocumentSessionState & {
  readonly canWrite: boolean;
};

const resolveCollabUrl = (): string => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/collab/document`;
};

const sendJson = (socket: WebSocket | null, message: unknown): boolean => {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
};

const batchChunks = (
  batches: ReadonlyArray<RichTextEventBatch>,
): ReadonlyArray<ReadonlyArray<RichTextEventBatch>> => {
  const chunks: RichTextEventBatch[][] = [];
  for (let index = 0; index < batches.length; index += 64) {
    chunks.push(batches.slice(index, index + 64));
  }
  return chunks;
};

const PRIVATE_SAVE_DEBOUNCE_MS = 400;

type TransportKind = "http" | "ws";

type SessionController = {
  readonly bindBinding: (binding: LexicalBinding | null) => void;
  readonly dispose: () => void;
  readonly flush: () => Promise<void>;
  readonly setShared: (isShared: boolean) => Promise<void>;
};

const createSessionController = ({
  documentId,
  initialShared,
  onCollaborationStatus,
  onError,
  onReplica,
  onSaveStatus,
  sessionMode,
}: {
  readonly documentId: string;
  readonly initialShared: boolean;
  readonly onCollaborationStatus: (status: CollaborationStatus) => void;
  readonly onError: (error: Error | null) => void;
  readonly onReplica: (replica: BlockReplica | null) => void;
  readonly onSaveStatus: (status: SaveStatus) => void;
  readonly sessionMode: DocumentSessionMode;
}): SessionController => {
  const supabase = createClient();
  const sessionId = crypto.randomUUID();
  const nextReplica = createBlockReplica(sessionId);
  const knownBatches = new Map(
    nextReplica.exportEvents().map((batch) => [batch.batchId, batch] as const),
  );
  const pendingBatches = new Map<string, RichTextEventBatch>();
  const bindingRef: { current: LexicalBinding | null } = { current: null };

  let cancelled = false;
  let storageUserId: string | null = null;
  let accessToken: string | null = null;
  let localPersistenceFailed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let synced = false;
  let fatalConnectionError = false;
  let activeRepairRequestId: string | null = null;
  let repairCursor: string | null = null;
  let privateSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let transport: TransportKind | null = null;
  let shareSwitch: Promise<void> = Promise.resolve();
  type FlushWaiter = {
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  };
  let flushWaiters: FlushWaiter[] = [];

  const saveCoordinator = createSaveCoordinator((status) => {
    if (!cancelled) onSaveStatus(status);
  });

  const resolveFlushWaiters = (): void => {
    if (pendingBatches.size > 0) return;
    const waiters = flushWaiters;
    flushWaiters = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  };

  const applyBatches = (batches: ReadonlyArray<RichTextEventBatch>): void => {
    for (const batch of batches) {
      if (knownBatches.has(batch.batchId)) continue;
      knownBatches.set(batch.batchId, batch);
      if (bindingRef.current === null) {
        nextReplica.applyRemoteEvents(batch);
      } else {
        bindingRef.current.applyRemoteEvents(batch);
      }
    }
  };

  const rememberPending = (batches: ReadonlyArray<RichTextEventBatch>) => {
    for (const batch of batches) {
      pendingBatches.set(batch.batchId, batch);
      knownBatches.set(batch.batchId, batch);
    }
    if (storageUserId === null) {
      throw new Error("Document storage is not initialized");
    }
    addPendingBatches(window.localStorage, documentId, storageUserId, batches);
  };

  const acknowledgePending = (batchIds: ReadonlyArray<string>) => {
    for (const batchId of batchIds) {
      pendingBatches.delete(batchId);
    }
    if (storageUserId === null) return;
    try {
      acknowledgePendingBatches(
        window.localStorage,
        documentId,
        storageUserId,
        batchIds,
      );
    } catch {
      // Durable retries are idempotent on the server.
    }
  };

  const persistHttp = async (): Promise<"ack" | "empty"> => {
    if (accessToken === null) {
      throw new Error("A signed-in session is required to save");
    }
    const batches = [...pendingBatches.values()];
    if (batches.length === 0) return "empty";
    const batchIds = await persistPrivateDocumentEvents({
      accessToken,
      batches,
      documentId,
    });
    acknowledgePending(batchIds);
    return pendingBatches.size === 0 ? "empty" : "ack";
  };

  const schedulePrivateSave = (): void => {
    if (transport !== "http" || localPersistenceFailed) return;
    if (privateSaveTimer !== null) clearTimeout(privateSaveTimer);
    privateSaveTimer = setTimeout(() => {
      privateSaveTimer = null;
      saveCoordinator.requestSave(persistHttp);
    }, PRIVATE_SAVE_DEBOUNCE_MS);
  };

  const publishWsPending = (): void => {
    if (!synced || pendingBatches.size === 0) return;
    let sent = false;
    for (const batches of batchChunks([...pendingBatches.values()])) {
      sent =
        sendJson(socket, {
          protocolVersion: COLLAB_PROTOCOL_VERSION,
          type: COLLAB_MESSAGE_TYPE.Event,
          batches,
        }) || sent;
    }
    if (sent && !localPersistenceFailed) onSaveStatus("saving");
  };

  const requestRepair = (afterCursor: string): void => {
    const requestId = crypto.randomUUID();
    activeRepairRequestId = requestId;
    sendJson(socket, {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.RepairRequest,
      requestId,
      afterCursor,
    });
  };

  const unsubscribeReplica = nextReplica.subscribe((change) => {
    if (change.origin !== "local") return;
    if (sessionMode === "public") {
      onError(new Error("Public document sessions are read-only"));
      onCollaborationStatus("error");
      return;
    }
    const newPendingBatches: RichTextEventBatch[] = [];
    for (const batchId of change.batchIds) {
      const batch = nextReplica.getBatch(batchId);
      if (batch === null) continue;
      knownBatches.set(batchId, batch);
      newPendingBatches.push(batch);
    }
    try {
      rememberPending(newPendingBatches);
    } catch {
      localPersistenceFailed = true;
      onError(new Error("Offline changes could not be saved in this browser"));
      onSaveStatus("error");
      return;
    }
    if (transport === "http") {
      schedulePrivateSave();
    } else if (transport === "ws") {
      publishWsPending();
    }
  });

  const ensureAuth = async (): Promise<boolean> => {
    if (sessionMode === "public") return true;
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (cancelled) return false;
    if (sessionError) {
      onError(new Error("Could not read the signed-in session"));
      onSaveStatus("error");
      return false;
    }
    const token = data.session?.access_token;
    const userId = data.session?.user.id;
    if (!token || !userId) {
      onError(new Error("A signed-in Supabase session is required"));
      onSaveStatus("error");
      return false;
    }
    if (storageUserId !== null && storageUserId !== userId) {
      onError(new Error("The signed-in user changed; reload this document"));
      onSaveStatus("error");
      return false;
    }
    accessToken = token;
    if (storageUserId === null) {
      storageUserId = userId;
      try {
        const restored = loadPendingBatches(
          window.localStorage,
          documentId,
          storageUserId,
        );
        if (restored.length > 0) {
          nextReplica.applyRemoteEvents(restored);
          for (const batch of restored) {
            knownBatches.set(batch.batchId, batch);
            pendingBatches.set(batch.batchId, batch);
          }
        }
      } catch {
        localPersistenceFailed = true;
        onError(
          new Error("Offline changes cannot be restored in this browser"),
        );
        onSaveStatus("error");
        return false;
      }
    }
    return true;
  };

  const stopWs = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const active = socket;
    socket = null;
    synced = false;
    active?.close();
  };

  const stopHttp = async (): Promise<void> => {
    if (privateSaveTimer !== null) {
      clearTimeout(privateSaveTimer);
      privateSaveTimer = null;
    }
    await saveCoordinator.flush(persistHttp);
  };

  const connectWs = async (): Promise<void> => {
    if (cancelled || transport !== "ws") return;
    if (!localPersistenceFailed) {
      onCollaborationStatus(
        reconnectAttempt === 0 ? "connecting" : "reconnecting",
      );
    }

    let credential:
      | { readonly kind: "access-token"; readonly token: string }
      | { readonly kind: "public" } = { kind: "public" };

    if (sessionMode === "authenticated") {
      if (!(await ensureAuth()) || cancelled || accessToken === null) {
        if (!cancelled && transport === "ws") {
          const delay = Math.min(500 * 2 ** reconnectAttempt, 10_000);
          reconnectAttempt += 1;
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void connectWs();
          }, delay);
        }
        return;
      }
      credential = { kind: "access-token", token: accessToken };
    }

    const nextSocket = new WebSocket(resolveCollabUrl());
    socket = nextSocket;

    nextSocket.addEventListener("open", () => {
      if (cancelled || socket !== nextSocket || transport !== "ws") return;
      sendJson(nextSocket, {
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Auth,
        credential,
        documentId,
        sessionId,
      });
    });

    nextSocket.addEventListener("message", (event) => {
      if (cancelled || socket !== nextSocket || transport !== "ws") return;
      let message;
      try {
        message = parseServerCollabMessage(JSON.parse(String(event.data)));
      } catch {
        fatalConnectionError = true;
        onError(new Error("The collaboration server returned invalid data"));
        onCollaborationStatus("error");
        closeCollabClientSocket(
          nextSocket,
          COLLAB_CLIENT_CLOSE_CODE.InvalidServerResponse,
          "Invalid collaboration response",
        );
        return;
      }

      try {
        switch (message.type) {
          case COLLAB_MESSAGE_TYPE.Ready:
            if (message.protocolVersion !== COLLAB_PROTOCOL_VERSION) {
              throw new Error("The collaboration protocol version is invalid");
            }
            if (
              message.accessMode !==
              (sessionMode === "public"
                ? COLLAB_ACCESS_MODE.Public
                : COLLAB_ACCESS_MODE.Authenticated)
            ) {
              throw new Error("The collaboration access mode is invalid");
            }
            reconnectAttempt = 0;
            fatalConnectionError = false;
            if (!localPersistenceFailed) onError(null);
            onCollaborationStatus("connected");
            synced = false;
            requestRepair(repairCursor ?? "0");
            return;
          case COLLAB_MESSAGE_TYPE.RepairResponse:
            if (message.requestId !== activeRepairRequestId) return;
            applyBatches(message.batches);
            if (
              repairCursor === null ||
              BigInt(message.nextCursor) > BigInt(repairCursor)
            ) {
              repairCursor = message.nextCursor;
            }
            if (!message.complete) {
              requestRepair(message.nextCursor);
              return;
            }
            activeRepairRequestId = null;
            synced = true;
            onReplica(nextReplica);
            publishWsPending();
            if (pendingBatches.size === 0 && !localPersistenceFailed) {
              onSaveStatus("saved");
            }
            return;
          case COLLAB_MESSAGE_TYPE.Event:
            applyBatches(message.batches);
            return;
          case COLLAB_MESSAGE_TYPE.DurableAck:
            acknowledgePending(message.batchIds);
            if (
              synced &&
              pendingBatches.size === 0 &&
              !localPersistenceFailed
            ) {
              onSaveStatus("saved");
            }
            resolveFlushWaiters();
            return;
          case COLLAB_MESSAGE_TYPE.Error:
            onError(new Error(message.message));
            if (!message.retryable) {
              fatalConnectionError = true;
              onCollaborationStatus("error");
            }
            closeCollabClientSocket(
              nextSocket,
              message.retryable
                ? COLLAB_CLIENT_CLOSE_CODE.RetryableServerError
                : COLLAB_CLIENT_CLOSE_CODE.FatalServerError,
              message.retryable ? "Retry collaboration sync" : "Fatal error",
            );
            return;
        }
      } catch (handlerError) {
        const applyError =
          handlerError instanceof Error
            ? handlerError
            : new Error("The collaboration response could not be applied");
        // Surface the apply failure before close() so a browser InvalidAccessError
        // from WebSocket.close cannot hide the collaboration error.
        onError(applyError);
        closeCollabClientSocket(
          nextSocket,
          COLLAB_CLIENT_CLOSE_CODE.ResponseApplyFailure,
          "Collaboration response could not be applied",
        );
      }
    });

    nextSocket.addEventListener("close", () => {
      if (cancelled || socket !== nextSocket || transport !== "ws") return;
      socket = null;
      synced = false;
      if (!fatalConnectionError) {
        onCollaborationStatus("offline");
        const delay = Math.min(500 * 2 ** reconnectAttempt, 10_000);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          void connectWs();
        }, delay);
      }
    });

    nextSocket.addEventListener("error", () => {
      if (socket === nextSocket) nextSocket.close();
    });
  };

  const startHttpTransport = async (): Promise<void> => {
    transport = "http";
    onCollaborationStatus("disabled");
    if (!(await ensureAuth()) || cancelled || accessToken === null) return;
    try {
      onSaveStatus("saving");
      const history = await loadPrivateDocumentHistory({
        accessToken,
        documentId,
      });
      if (cancelled) return;
      applyBatches(history);
      onReplica(nextReplica);
      if (pendingBatches.size > 0) {
        saveCoordinator.requestSave(persistHttp);
      } else {
        onSaveStatus("saved");
      }
    } catch (loadError) {
      if (cancelled) return;
      onError(
        loadError instanceof Error
          ? loadError
          : new Error("Could not load the private document"),
      );
      onSaveStatus("error");
      onReplica(nextReplica);
    }
  };

  const startWsTransport = async (): Promise<void> => {
    transport = "ws";
    reconnectAttempt = 0;
    fatalConnectionError = false;
    onCollaborationStatus("connecting");
    await connectWs();
  };

  const setShared = async (isShared: boolean): Promise<void> => {
    const run = async (): Promise<void> => {
      if (cancelled) return;
      const desired: TransportKind =
        isShared || sessionMode === "public" ? "ws" : "http";
      if (transport === desired) return;

      if (desired === "ws") {
        // Flush private HTTP persistence before opening collaboration so the
        // server already has canonical content; in-flight local edits remain in
        // pendingBatches and are published after WS repair.
        if (transport === "http") {
          await stopHttp();
        }
        if (cancelled) return;
        await startWsTransport();
        return;
      }

      stopWs();
      await startHttpTransport();
    };

    shareSwitch = shareSwitch.then(run, run);
    await shareSwitch;
  };

  const flush = async (): Promise<void> => {
    if (privateSaveTimer !== null) {
      clearTimeout(privateSaveTimer);
      privateSaveTimer = null;
    }
    if (transport === "http") {
      await saveCoordinator.flush(persistHttp);
      return;
    }
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Could not save the latest edits before sharing");
    }
    // One-shot publish; DurableAck resolves flush. Re-publish only on reconnect.
    publishWsPending();
    if (pendingBatches.size === 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        flushWaiters = flushWaiters.filter(
          (waiter) => waiter.resolve !== resolve,
        );
        reject(new Error("Could not save the latest edits before sharing"));
      }, 5_000);
      flushWaiters.push({ reject, resolve, timer });
      // A concurrent DurableAck may have already drained the queue.
      resolveFlushWaiters();
    });
  };

  void setShared(initialShared);

  return {
    bindBinding: (binding: LexicalBinding | null) => {
      bindingRef.current = binding;
    },
    dispose: () => {
      cancelled = true;
      saveCoordinator.dispose();
      unsubscribeReplica();
      bindingRef.current = null;
      if (privateSaveTimer !== null) clearTimeout(privateSaveTimer);
      for (const waiter of flushWaiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Document session was disposed"));
      }
      flushWaiters = [];
      stopWs();
      transport = null;
      onReplica(null);
    },
    flush,
    setShared,
  };
};

export const useDocumentSession = ({
  documentId,
  isShared,
  permission,
  sessionMode = "authenticated",
}: {
  readonly documentId: string;
  readonly isShared: boolean;
  readonly permission: DocumentPermission | null;
  readonly sessionMode?: DocumentSessionMode;
}): DocumentSessionState => {
  const editable = isDocumentEditable({ permission, sessionMode });
  const [replica, setReplica] = useState<BlockReplica | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [collaborationStatus, setCollaborationStatus] =
    useState<CollaborationStatus>(isShared ? "connecting" : "disabled");
  const [error, setError] = useState<Error | null>(null);
  const controllerRef = useRef<SessionController | null>(null);

  const onBindingChange = useCallback((binding: LexicalBinding | null) => {
    controllerRef.current?.bindBinding(binding);
  }, []);

  const status = useMemo(
    () => deriveDocumentUiStatus({ collaborationStatus, saveStatus }),
    [collaborationStatus, saveStatus],
  );

  useEffect(() => {
    setReplica(null);
    setError(null);
    setSaveStatus("idle");
    setCollaborationStatus(isShared ? "connecting" : "disabled");

    const controller = createSessionController({
      documentId,
      initialShared: isShared,
      onCollaborationStatus: setCollaborationStatus,
      onError: setError,
      onReplica: setReplica,
      onSaveStatus: setSaveStatus,
      sessionMode,
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
    // isShared is applied via setShared below so private→shared keeps the replica.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [documentId, sessionMode]);

  useEffect(() => {
    void controllerRef.current?.setShared(isShared);
  }, [isShared]);

  const flush = useCallback(async () => {
    await controllerRef.current?.flush();
  }, []);

  return useMemo(
    () => ({
      collaborationStatus,
      editable,
      error,
      flush,
      onBindingChange,
      replica,
      saveStatus,
      status,
    }),
    [
      collaborationStatus,
      editable,
      error,
      flush,
      onBindingChange,
      replica,
      saveStatus,
      status,
    ],
  );
};

/** Compatibility wrapper used by older collab-only call sites. */
export const useCollabDocument = (
  documentId: string,
  sessionMode: CollabSessionMode = "authenticated",
  options?: {
    readonly isShared?: boolean;
    readonly permission?: DocumentPermission | null;
  },
): CollabDocumentState => {
  const session = useDocumentSession({
    documentId,
    isShared: options?.isShared ?? true,
    permission: options?.permission ?? null,
    sessionMode,
  });
  return {
    ...session,
    canWrite: session.editable,
  };
};
