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
import { createOutgoingBatchQueue } from "@/modules/docs/collab-outgoing-queue";
import {
  getReconnectDelay,
  isBrowserOffline,
} from "@/modules/docs/collab-reconnect";
import type { CollabTarget } from "@/modules/docs/collab-target";
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

const sendJson = (socket: WebSocket | null, message: unknown): boolean => {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
};

const WS_MAX_BATCHES_PER_SEND = 64;
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
  documentUrl,
  initialShared,
  onCollaborationStatus,
  onError,
  onReplica,
  onSaveStatus,
  sessionMode,
}: {
  readonly documentId: string;
  /** Server-resolved document endpoint; the client never re-derives it. */
  readonly documentUrl: string;
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
  const bindingRef: { current: LexicalBinding | null } = { current: null };
  // Declared before the queue so send can close over the live socket.
  let socket: WebSocket | null = null;
  const outgoing = createOutgoingBatchQueue<RichTextEventBatch>({
    maxBatchesPerSend: WS_MAX_BATCHES_PER_SEND,
    send: (batches) =>
      sendJson(socket, {
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Event,
        batches,
      }),
  });

  let cancelled = false;
  let storageUserId: string | null = null;
  let accessToken: string | null = null;
  let localPersistenceFailed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  /**
   * Bumped by every WebSocket teardown. Callbacks captured under an older
   * generation — a pending reconnect timer, an awaited auth read, socket
   * listeners — must never touch the live session or open a socket for a
   * session that has already been retired.
   */
  let wsGeneration = 0;
  /** True from the start of a connect attempt until its socket exists. */
  let connectPending = false;
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
    if (outgoing.hasPending()) return;
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
    if (storageUserId === null) {
      throw new Error("Document storage is not initialized");
    }
    // Persist offline first so a storage failure leaves the outgoing queue
    // unchanged and cannot flip flush/saved state for unsent batches.
    addPendingBatches(window.localStorage, documentId, storageUserId, batches);
    for (const batch of batches) {
      knownBatches.set(batch.batchId, batch);
    }
    // Track only; transport code decides when to open a durable write.
    outgoing.add(batches);
  };

  const acknowledgePending = (batchIds: ReadonlyArray<string>) => {
    outgoing.acknowledge(batchIds);
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
    const batches = outgoing.peekPending();
    if (batches.length === 0) return "empty";
    const batchIds = await persistPrivateDocumentEvents({
      accessToken,
      batches,
      documentId,
    });
    acknowledgePending(batchIds);
    return outgoing.hasPending() ? "ack" : "empty";
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
    if (!synced) return;
    // One in-flight durable write per session; further pending chunks wait for
    // DurableAck so causally dependent batches are never validated early.
    const sent = outgoing.flush();
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
          }
          outgoing.add(restored);
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

  const clearReconnectTimer = (): void => {
    if (reconnectTimer === null) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const stopWs = (): void => {
    // Retire every callback captured by the current WebSocket session before
    // anything can observe the torn-down state.
    wsGeneration += 1;
    connectPending = false;
    clearReconnectTimer();
    const active = socket;
    socket = null;
    synced = false;
    // Preserve pending batch identity; allow exact resend after reconnect.
    outgoing.resetInFlight();
    active?.close();
  };

  /**
   * Arm the next reconnect. At most one timer exists per session: a pending
   * timer, a live socket, or an in-flight connect attempt each mean the
   * close/online/visibility event that reached here is already covered.
   */
  const scheduleReconnect = (): void => {
    if (cancelled || transport !== "ws" || fatalConnectionError) return;
    if (reconnectTimer !== null || connectPending || socket !== null) return;
    if (isBrowserOffline()) {
      // Retries cannot reach the backend while the browser reports no
      // connectivity, so the loop stops here and the `online` listener resumes
      // it. The attempt counter is left untouched: an offline stretch must not
      // inflate the backoff a real reconnect starts from.
      return;
    }
    const delay = getReconnectDelay(reconnectAttempt);
    reconnectAttempt += 1;
    const generation = wsGeneration;
    const timer = setTimeout(() => {
      if (reconnectTimer === timer) reconnectTimer = null;
      if (generation !== wsGeneration) return;
      void connectWs();
    }, delay);
    reconnectTimer = timer;
  };

  /**
   * Reconnect now rather than waiting out the armed backoff. Driven by the
   * browser signals that make a suppressed or pending retry worth attempting
   * again — connectivity returning, or the page becoming visible. A healthy or
   * in-flight connection is never disturbed.
   */
  const reconnectNow = (): void => {
    if (cancelled || transport !== "ws" || fatalConnectionError) return;
    if (socket !== null || connectPending) return;
    if (isBrowserOffline()) return;
    clearReconnectTimer();
    void connectWs();
  };

  const stopHttp = async (): Promise<void> => {
    if (privateSaveTimer !== null) {
      clearTimeout(privateSaveTimer);
      privateSaveTimer = null;
    }
    await saveCoordinator.flush(persistHttp);
  };

  /**
   * Open the collaboration socket for the endpoint this session was created
   * with. `documentUrl` is resolved once by the server and never re-derived
   * here, so a reconnect can only ever return to the runtime that already owns
   * the document — runtime handoff is a separate concern that replaces the
   * whole controller.
   */
  const connectWs = async (): Promise<void> => {
    if (cancelled || transport !== "ws" || fatalConnectionError) return;
    // One connection attempt and one socket per session; a close, a timer, an
    // `online` event and a visibility change can all land at once.
    if (connectPending || socket !== null) return;
    const generation = wsGeneration;
    connectPending = true;
    clearReconnectTimer();
    if (!localPersistenceFailed) {
      onCollaborationStatus(
        reconnectAttempt === 0 ? "connecting" : "reconnecting",
      );
    }

    let credential:
      | { readonly kind: "access-token"; readonly token: string }
      | { readonly kind: "public" } = { kind: "public" };

    if (sessionMode === "authenticated") {
      // A rejected session read (offline Supabase, aborted fetch) is a
      // transient connect failure; the retry loop must survive it rather than
      // leave the attempt flag stuck.
      const authenticated = await ensureAuth().catch(() => false);
      // Reading the session yields to the event loop: a dispose or a transport
      // switch may have retired this attempt in the meantime. A retired
      // attempt must not clear `connectPending`, which a newer attempt may
      // already own — that is how two sockets would end up open at once.
      if (generation !== wsGeneration) return;
      if (cancelled || transport !== "ws") {
        connectPending = false;
        return;
      }
      if (!authenticated || accessToken === null) {
        connectPending = false;
        scheduleReconnect();
        return;
      }
      credential = { kind: "access-token", token: accessToken };
    }

    let nextSocket: WebSocket;
    try {
      nextSocket = new WebSocket(documentUrl);
    } catch {
      // The constructor only throws for an unusable endpoint (invalid URL,
      // rejected scheme). Retrying cannot change that, so fail the session
      // instead of spinning the reconnect loop.
      connectPending = false;
      fatalConnectionError = true;
      onError(new Error("The collaboration endpoint could not be opened"));
      onCollaborationStatus("error");
      return;
    }
    socket = nextSocket;
    connectPending = false;

    nextSocket.addEventListener("open", () => {
      if (generation !== wsGeneration) return;
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
      if (generation !== wsGeneration) return;
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
            // The connection is proven usable: drop any obsolete backoff so
            // the next disconnect starts from the shortest window again.
            clearReconnectTimer();
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
            if (!outgoing.hasPending() && !localPersistenceFailed) {
              onSaveStatus("saved");
            }
            return;
          case COLLAB_MESSAGE_TYPE.Event:
            applyBatches(message.batches);
            return;
          case COLLAB_MESSAGE_TYPE.DurableAck:
            acknowledgePending(message.batchIds);
            if (synced && !outgoing.hasPending() && !localPersistenceFailed) {
              onSaveStatus("saved");
            } else if (
              synced &&
              outgoing.hasInFlight() &&
              !localPersistenceFailed
            ) {
              onSaveStatus("saving");
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
      if (generation !== wsGeneration) return;
      if (cancelled || socket !== nextSocket || transport !== "ws") return;
      socket = null;
      synced = false;
      // Drop in-flight markers only; pending payloads stay for idempotent resend.
      outgoing.resetInFlight();
      if (fatalConnectionError) return;
      onCollaborationStatus("offline");
      scheduleReconnect();
    });

    nextSocket.addEventListener("error", () => {
      if (generation !== wsGeneration) return;
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
      if (outgoing.hasPending()) {
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
        // server already has canonical content; local edits remain in the
        // outgoing queue and are published after WS repair.
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
    if (!synced) {
      throw new Error(
        "Could not save the latest edits while collaboration sync is in progress",
      );
    }
    // One-shot publish; DurableAck resolves flush. Re-publish only on reconnect.
    publishWsPending();
    if (!outgoing.hasPending()) return;
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

  /**
   * Connectivity returning is the signal that ends an offline suppression, and
   * a page becoming visible is the signal that a user is waiting on a retry
   * that is still backing off. Neither ever closes a live socket: a hidden tab
   * keeps collaborating exactly as before.
   */
  const handleOnline = (): void => {
    reconnectNow();
  };

  const handleVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") return;
    reconnectNow();
  };

  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  void setShared(initialShared);

  return {
    bindBinding: (binding: LexicalBinding | null) => {
      bindingRef.current = binding;
    },
    dispose: () => {
      cancelled = true;
      // Detach first: no browser signal may reach a session being torn down.
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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
  collabTarget,
  documentId,
  isShared,
  permission,
  sessionMode = "authenticated",
}: {
  readonly collabTarget: CollabTarget;
  readonly documentId: string;
  readonly isShared: boolean;
  readonly permission: DocumentPermission | null;
  readonly sessionMode?: DocumentSessionMode;
}): DocumentSessionState => {
  // Depend on the resolved endpoint itself: a runtime handoff changes it, and
  // an unchanged endpoint must never tear the live session down.
  const { documentUrl } = collabTarget;
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
      documentUrl,
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
  }, [documentId, documentUrl, sessionMode]);

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

/**
 * Compatibility wrapper used by older collab-only call sites. The target is
 * required: a client-side default would be exactly the silent runtime guess
 * this module no longer makes.
 */
export const useCollabDocument = (
  collabTarget: CollabTarget,
  documentId: string,
  sessionMode: CollabSessionMode = "authenticated",
  options?: {
    readonly isShared?: boolean;
    readonly permission?: DocumentPermission | null;
  },
): CollabDocumentState => {
  const session = useDocumentSession({
    collabTarget,
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
