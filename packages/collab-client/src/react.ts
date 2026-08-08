import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!options || !documentId || !replicaId || !wsUrl) {
      setSession(null);
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    const next = createCollabSession(options);
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
    // options.getAccessToken / parseBatch are expected to be stable by callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity by room keys
  }, [documentId, replicaId, wsUrl]);

  return { session, snapshot, error };
};
