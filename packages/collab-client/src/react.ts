import { parseWireBatch } from "@softmaple/collab-protocol";
import { useEffect, useRef, useState } from "react";
import {
  createCollabSession,
  type CollabSession,
  type CollabSessionSnapshot,
  type CreateCollabSessionOptions,
} from "./session";

export interface UseCollabSessionResult {
  readonly session: CollabSession | null;
  readonly snapshot: CollabSessionSnapshot | null;
  readonly error: Error | null;
}

export const useCollabSession = (
  options: CreateCollabSessionOptions | null,
): UseCollabSessionResult => {
  const [session, setSession] = useState<CollabSession | null>(null);
  const [snapshot, setSnapshot] = useState<CollabSessionSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const documentId = options?.documentId ?? null;
  const replicaId = options?.replicaId ?? null;
  const wsUrl = options?.wsUrl ?? null;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    setError(null);
    const current = optionsRef.current;
    if (!current || !documentId || !replicaId || !wsUrl) {
      setSession(null);
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    const next = createCollabSession({
      ...current,
      documentId,
      replicaId,
      wsUrl,
      getAccessToken: () => {
        const fn = optionsRef.current?.getAccessToken;
        if (!fn) return Promise.reject(new Error("Missing getAccessToken"));
        return fn();
      },
      parseBatch: (input) => {
        const parseBatch = optionsRef.current?.parseBatch ?? parseWireBatch;
        return parseBatch(input);
      },
    });
    const unsubSnapshot = next.subscribeSnapshot((value) => {
      if (!cancelled) setSnapshot(value);
    });
    const unsubErrors = next.subscribeErrors((value) => {
      if (!cancelled) setError(value);
    });
    setSession(next);
    void next.start().catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });

    return () => {
      cancelled = true;
      unsubSnapshot();
      unsubErrors();
      next.close();
    };
  }, [documentId, replicaId, wsUrl]);

  return { session, snapshot, error };
};
