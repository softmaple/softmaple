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
    const supabase = createClient();
    const sessionId = crypto.randomUUID();
    const nextReplica = createBlockReplica(sessionId);
    const knownBatches = new Map(
      nextReplica
        .exportEvents()
        .map((batch) => [batch.batchId, batch] as const),
    );
    const pendingBatches = new Map<string, RichTextEventBatch>();
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let retryPendingTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let synced = false;
    let activeRepairRequestId: string | null = null;

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
      for (const batches of batchChunks([...pendingBatches.values()])) {
        sendJson(socket, {
          protocolVersion: COLLAB_PROTOCOL_VERSION,
          type: COLLAB_MESSAGE_TYPE.Event,
          batches,
        });
      }
      setStatus("saving");
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
      for (const batchId of change.batchIds) {
        const batch = knownBatches.get(batchId);
        if (batch !== undefined) pendingBatches.set(batchId, batch);
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
      setStatus(reconnectAttempt === 0 ? "connecting" : "offline");

      const { data, error: sessionError } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (sessionError || !accessToken) {
        setError(new Error("A signed-in Supabase session is required"));
        setStatus("error");
        return;
      }

      const nextSocket = new WebSocket(resolveCollabUrl());
      socket = nextSocket;

      nextSocket.addEventListener("open", () => {
        if (cancelled || socket !== nextSocket) return;
        reconnectAttempt = 0;
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
        try {
          const message = parseServerCollabMessage(
            JSON.parse(String(event.data)),
          );
          switch (message.type) {
            case COLLAB_MESSAGE_TYPE.Ready:
              setCanWrite(message.canWrite);
              setStatus("syncing");
              synced = false;
              requestRepair("0");
              return;
            case COLLAB_MESSAGE_TYPE.RepairResponse:
              if (message.requestId !== activeRepairRequestId) return;
              applyBatches(message.batches);
              if (!message.complete) {
                requestRepair(message.nextCursor);
                return;
              }
              activeRepairRequestId = null;
              synced = true;
              setReplica(nextReplica);
              publishPending();
              if (pendingBatches.size === 0) setStatus("saved");
              return;
            case COLLAB_MESSAGE_TYPE.Event:
              applyBatches(message.batches);
              return;
            case COLLAB_MESSAGE_TYPE.DurableAck:
              for (const batchId of message.batchIds) {
                pendingBatches.delete(batchId);
              }
              if (synced && pendingBatches.size === 0) setStatus("saved");
              return;
            case COLLAB_MESSAGE_TYPE.Error:
              setError(new Error(message.message));
              if (!message.retryable) {
                setStatus("error");
              } else if (retryPendingTimer === null) {
                retryPendingTimer = setTimeout(() => {
                  retryPendingTimer = null;
                  publishPending();
                }, 1_000);
              }
              return;
          }
        } catch {
          setError(new Error("The collaboration server returned invalid data"));
          setStatus("error");
        }
      });

      nextSocket.addEventListener("close", () => {
        if (cancelled || socket !== nextSocket) return;
        socket = null;
        synced = false;
        setStatus("offline");
        scheduleReconnect();
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
      if (retryPendingTimer !== null) clearTimeout(retryPendingTimer);
      socket?.close();
    };
  }, [documentId]);

  return { replica, status, canWrite, error, onBindingChange };
};
