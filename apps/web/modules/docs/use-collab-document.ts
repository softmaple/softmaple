"use client";

import type { LexicalBinding } from "@softmaple/binding-lexical";
import {
  createBlockReplica,
  type BlockReplica,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import {
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  parseServerCollabMessage,
} from "@softmaple/collab-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  acknowledgePendingBatches,
  addPendingBatches,
  loadPendingBatches,
} from "@/modules/docs/collab-pending-store";
import { createClient } from "@/utils/supabase/client";

export type CollabDocumentStatus =
  | "connecting"
  | "syncing"
  | "saving"
  | "saved"
  | "offline"
  | "error";

export interface CollabDocumentState {
  readonly replica: BlockReplica | null;
  readonly status: CollabDocumentStatus;
  readonly canWrite: boolean;
  readonly error: Error | null;
  readonly onBindingChange: (binding: LexicalBinding | null) => void;
}

const resolveCollabUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_COLLAB_WS_URL;
  if (configured) return configured;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (window.location.hostname === "localhost") {
    return `${protocol}//localhost:3002/document`;
  }
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

export const useCollabDocument = (documentId: string): CollabDocumentState => {
  const [replica, setReplica] = useState<BlockReplica | null>(null);
  const [status, setStatus] = useState<CollabDocumentStatus>("connecting");
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const bindingRef = useRef<LexicalBinding | null>(null);

  const onBindingChange = useCallback((binding: LexicalBinding | null) => {
    bindingRef.current = binding;
  }, []);

  useEffect(() => {
    setReplica(null);
    setCanWrite(false);
    setError(null);
    setStatus("connecting");

    const supabase = createClient();
    const sessionId = crypto.randomUUID();
    const nextReplica = createBlockReplica(sessionId);
    let localPersistenceFailed = false;
    const knownBatches = new Map(
      nextReplica
        .exportEvents()
        .map((batch) => [batch.batchId, batch] as const),
    );
    const pendingBatches = new Map<string, RichTextEventBatch>();
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let cancelled = false;
    let synced = false;
    let fatalConnectionError = false;
    let storageUserId: string | null = null;
    let activeRepairRequestId: string | null = null;
    let repairCursor: string | null = null;

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

    const publishPending = (): void => {
      if (!synced || pendingBatches.size === 0) return;
      let sentAtLeastOneBatch = false;
      for (const batches of batchChunks([...pendingBatches.values()])) {
        sentAtLeastOneBatch =
          sendJson(socket, {
            protocolVersion: COLLAB_PROTOCOL_VERSION,
            type: COLLAB_MESSAGE_TYPE.Event,
            batches,
          }) || sentAtLeastOneBatch;
      }
      if (sentAtLeastOneBatch && !localPersistenceFailed) setStatus("saving");
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
      for (const batch of nextReplica.exportEvents()) {
        knownBatches.set(batch.batchId, batch);
      }
      const newPendingBatches: RichTextEventBatch[] = [];
      for (const batchId of change.batchIds) {
        const batch = knownBatches.get(batchId);
        if (batch !== undefined) {
          pendingBatches.set(batchId, batch);
          newPendingBatches.push(batch);
        }
      }
      try {
        if (storageUserId === null) {
          throw new Error("Collaboration storage is not initialized");
        }
        addPendingBatches(
          window.localStorage,
          documentId,
          storageUserId,
          newPendingBatches,
        );
      } catch {
        localPersistenceFailed = true;
        setCanWrite(false);
        setError(
          new Error("Offline changes could not be saved in this browser"),
        );
        setStatus("error");
      }
      publishPending();
    });

    const scheduleReconnect = (): void => {
      if (cancelled || reconnectTimer !== null) return;
      const delay = Math.min(500 * 2 ** reconnectAttempt, 10_000);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const connect = async (): Promise<void> => {
      if (cancelled) return;
      if (!localPersistenceFailed) {
        setStatus(reconnectAttempt === 0 ? "connecting" : "offline");
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (cancelled) return;
      if (sessionError) {
        if (!localPersistenceFailed) setStatus("offline");
        scheduleReconnect();
        return;
      }
      const accessToken = data.session?.access_token;
      const userId = data.session?.user.id;
      if (!accessToken || !userId) {
        fatalConnectionError = true;
        setError(new Error("A signed-in Supabase session is required"));
        setStatus("error");
        return;
      }

      if (storageUserId !== null && storageUserId !== userId) {
        fatalConnectionError = true;
        setCanWrite(false);
        setError(new Error("The signed-in user changed; reload this document"));
        setStatus("error");
        return;
      }
      if (storageUserId === null) {
        storageUserId = userId;
        try {
          const restoredBatches = loadPendingBatches(
            window.localStorage,
            documentId,
            storageUserId,
          );
          if (restoredBatches.length > 0) {
            nextReplica.applyRemoteEvents(restoredBatches);
            for (const batch of restoredBatches) {
              knownBatches.set(batch.batchId, batch);
              pendingBatches.set(batch.batchId, batch);
            }
          }
        } catch {
          localPersistenceFailed = true;
          setCanWrite(false);
          setError(
            new Error("Offline changes cannot be restored in this browser"),
          );
          setStatus("error");
        }
      }

      const nextSocket = new WebSocket(resolveCollabUrl());
      socket = nextSocket;

      nextSocket.addEventListener("open", () => {
        if (cancelled || socket !== nextSocket) return;
        sendJson(nextSocket, {
          protocolVersion: COLLAB_PROTOCOL_VERSION,
          type: COLLAB_MESSAGE_TYPE.Auth,
          accessToken,
          documentId,
          sessionId,
        });
      });

      nextSocket.addEventListener("message", (event) => {
        if (cancelled || socket !== nextSocket) return;
        let message;
        try {
          message = parseServerCollabMessage(JSON.parse(String(event.data)));
        } catch {
          fatalConnectionError = true;
          setError(new Error("The collaboration server returned invalid data"));
          setStatus("error");
          setCanWrite(false);
          nextSocket.close(1008, "Invalid collaboration response");
          return;
        }

        try {
          switch (message.type) {
            case COLLAB_MESSAGE_TYPE.Ready:
              reconnectAttempt = 0;
              fatalConnectionError = false;
              if (!localPersistenceFailed) setError(null);
              setCanWrite(message.canWrite && !localPersistenceFailed);
              if (!localPersistenceFailed) setStatus("syncing");
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
              setReplica(nextReplica);
              publishPending();
              if (pendingBatches.size === 0 && !localPersistenceFailed) {
                setStatus("saved");
              }
              return;
            case COLLAB_MESSAGE_TYPE.Event:
              applyBatches(message.batches);
              return;
            case COLLAB_MESSAGE_TYPE.DurableAck:
              for (const batchId of message.batchIds) {
                pendingBatches.delete(batchId);
              }
              if (storageUserId !== null) {
                try {
                  acknowledgePendingBatches(
                    window.localStorage,
                    documentId,
                    storageUserId,
                    message.batchIds,
                  );
                } catch {
                  // A stale durable batch may be retried after a reload; the
                  // server's idempotent append makes that safe.
                }
              }
              if (
                synced &&
                pendingBatches.size === 0 &&
                !localPersistenceFailed
              ) {
                setStatus("saved");
              }
              return;
            case COLLAB_MESSAGE_TYPE.Error:
              setError(new Error(message.message));
              if (!message.retryable) {
                fatalConnectionError = true;
                setStatus("error");
                setCanWrite(false);
              }
              nextSocket.close(
                message.retryable ? 1011 : 1008,
                message.retryable ? "Retry collaboration sync" : "Fatal error",
              );
              return;
          }
        } catch (handlerError) {
          setError(
            handlerError instanceof Error
              ? handlerError
              : new Error("The collaboration response could not be applied"),
          );
          nextSocket.close(1011, "Collaboration response could not be applied");
        }
      });

      nextSocket.addEventListener("close", () => {
        if (cancelled || socket !== nextSocket) return;
        socket = null;
        synced = false;
        setCanWrite(false);
        if (!fatalConnectionError) {
          if (!localPersistenceFailed) setStatus("offline");
          scheduleReconnect();
        }
      });

      nextSocket.addEventListener("error", () => {
        if (socket === nextSocket) nextSocket.close();
      });
    };

    void connect();

    return () => {
      cancelled = true;
      unsubscribeReplica();
      bindingRef.current = null;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [documentId]);

  return { replica, status, canWrite, error, onBindingChange };
};
