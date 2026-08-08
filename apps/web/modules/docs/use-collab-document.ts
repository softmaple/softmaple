"use client";

import {
  createBlockReplica,
  parseRichTextEventBatch,
  type BlockReplica,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import {
  createCollabSession,
  type CollabSession,
  type CollabSessionSnapshot,
} from "@softmaple/collab-client";
import type { WireBatch } from "@softmaple/collab-protocol";
import type { LexicalBinding } from "@softmaple/binding-lexical";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";

export interface UseCollabDocumentResult {
  readonly replica: BlockReplica | null;
  readonly session: CollabSession | null;
  readonly snapshot: CollabSessionSnapshot | null;
  readonly error: Error | null;
  readonly onBindingChange: (binding: LexicalBinding | null) => void;
}

const wireBatch = (batch: RichTextEventBatch): WireBatch => batch;

const resolveCollabWsUrl = (documentId: string): string => {
  const base =
    process.env.NEXT_PUBLIC_COLLAB_WS_URL ?? "ws://localhost:4001/ws/document";
  // documentId is carried in the auth frame, not the URL.
  void documentId;
  return base;
};

export const useCollabDocument = (
  documentId: string,
  enabled: boolean,
): UseCollabDocumentResult => {
  const [replica, setReplica] = useState<BlockReplica | null>(null);
  const [session, setSession] = useState<CollabSession | null>(null);
  const [snapshot, setSnapshot] = useState<CollabSessionSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const bindingRef = useRef<LexicalBinding | null>(null);
  const replicaIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (replicaIdRef.current === null) {
      replicaIdRef.current = crypto.randomUUID();
    }
    const replicaId = replicaIdRef.current;
    const nextReplica = createBlockReplica(replicaId);
    const nextSession = createCollabSession({
      documentId,
      replicaId,
      wsUrl: resolveCollabWsUrl(documentId),
      getAccessToken: async () => {
        const supabase = createClient();
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const token = data.session?.access_token;
        if (!token) throw new Error("Missing Supabase access token");
        return token;
      },
      parseBatch: (input) => parseRichTextEventBatch(input),
    });

    const applyIncoming = (batch: WireBatch): void => {
      const parsed = parseRichTextEventBatch(batch);
      const binding = bindingRef.current;
      if (binding) binding.applyRemoteEvents(parsed);
      else nextReplica.applyRemoteEvents(parsed);
    };

    const unsubBatches = nextSession.subscribeBatches((batch, source) => {
      if (source !== "local") applyIncoming(batch);
    });
    for (const batch of nextSession.getKnownBatches()) {
      applyIncoming(batch);
    }

    const localBatches = new Map(
      nextReplica
        .exportEvents()
        .map((batch) => [batch.batchId, batch] as const),
    );
    const unsubReplica = nextReplica.subscribe((change) => {
      if (change.origin !== "local") return;
      for (const batchId of change.batchIds) {
        if (!localBatches.has(batchId)) {
          for (const batch of nextReplica.exportEvents()) {
            localBatches.set(batch.batchId, batch);
          }
          break;
        }
      }
      for (const batchId of change.batchIds) {
        const batch = localBatches.get(batchId);
        if (batch !== undefined) nextSession.publishBatch(wireBatch(batch));
      }
    });
    const unsubSnapshot = nextSession.subscribeSnapshot(setSnapshot);
    const unsubErrors = nextSession.subscribeErrors(setError);

    setReplica(nextReplica);
    setSession(nextSession);
    void nextSession.start().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    });

    return () => {
      unsubBatches();
      unsubReplica();
      unsubSnapshot();
      unsubErrors();
      nextSession.close();
      bindingRef.current = null;
      setReplica(null);
      setSession(null);
    };
  }, [documentId, enabled]);

  return {
    replica,
    session,
    snapshot,
    error,
    onBindingChange: (binding) => {
      bindingRef.current = binding;
    },
  };
};
