export const LEADER_ELECTION_STATUS = {
  Error: "error",
  Leader: "leader",
  Stopped: "stopped",
  Unsupported: "unsupported",
  Waiting: "waiting",
} as const;

export type LeaderElectionStatus =
  (typeof LEADER_ELECTION_STATUS)[keyof typeof LEADER_ELECTION_STATUS];

export interface LeaderElectionSnapshot {
  readonly status: LeaderElectionStatus;
  readonly isLeader: boolean;
  readonly errorMessage: string | null;
}

export interface LockHandleLike {
  readonly name: string;
  readonly mode: "exclusive" | "shared";
}

export interface ExclusiveLockRequestOptions {
  readonly mode: "exclusive";
  readonly signal: AbortSignal;
}

export interface LockManagerLike {
  request(
    name: string,
    options: ExclusiveLockRequestOptions,
    callback: (lock: LockHandleLike) => Promise<void> | void,
  ): Promise<void>;
}

export interface LeaderElection {
  start(): void;
  stop(): Promise<void>;
  getSnapshot(): LeaderElectionSnapshot;
  subscribe(listener: (snapshot: LeaderElectionSnapshot) => void): () => void;
}

export interface CreateLeaderElectionOptions {
  readonly roomId: string;
  readonly lockManager?: LockManagerLike | null;
}

export const getPersistenceLeaderLockName = (roomId: string): string =>
  `softmaple:lexical-eg-walker:v1:persistence:${encodeURIComponent(roomId)}`;

const getNativeLockManager = (): LockManagerLike | null => {
  if (typeof navigator === "undefined" || navigator.locks === undefined) {
    return null;
  }

  const lockManager = navigator.locks;
  return {
    request: async (name, options, callback) => {
      await lockManager.request(name, options, async (lock) => {
        if (lock === null) {
          throw new Error("Exclusive persistence lock was not granted");
        }
        await callback({ name: lock.name, mode: lock.mode });
      });
    },
  };
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Web Locks leader election failed";

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

const createSnapshot = (
  status: LeaderElectionStatus,
  message: string | null = null,
): LeaderElectionSnapshot => ({
  status,
  isLeader: status === LEADER_ELECTION_STATUS.Leader,
  errorMessage: message,
});

export const createLeaderElection = (
  options: CreateLeaderElectionOptions,
): LeaderElection => {
  const lockManager =
    options.lockManager === undefined
      ? getNativeLockManager()
      : options.lockManager;
  const listeners = new Set<(snapshot: LeaderElectionSnapshot) => void>();
  let snapshot = createSnapshot(LEADER_ELECTION_STATUS.Stopped);
  let abortController: AbortController | null = null;
  let releaseLock: (() => void) | null = null;
  let requestPromise: Promise<void> | null = null;
  let active = false;

  const setSnapshot = (next: LeaderElectionSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };

  const start = (): void => {
    if (active) return;
    if (lockManager === null) {
      setSnapshot(createSnapshot(LEADER_ELECTION_STATUS.Unsupported));
      return;
    }

    active = true;
    abortController = new AbortController();
    setSnapshot(createSnapshot(LEADER_ELECTION_STATUS.Waiting));

    requestPromise = lockManager
      .request(
        getPersistenceLeaderLockName(options.roomId),
        { mode: "exclusive", signal: abortController.signal },
        async () => {
          if (!active) return;
          setSnapshot(createSnapshot(LEADER_ELECTION_STATUS.Leader));
          await new Promise<void>((resolve) => {
            releaseLock = resolve;
          });
          releaseLock = null;
        },
      )
      .then(() => {
        if (!active) return;
        active = false;
        setSnapshot(
          createSnapshot(
            LEADER_ELECTION_STATUS.Error,
            "Persistence leader lock was released unexpectedly",
          ),
        );
      })
      .catch((error: unknown) => {
        if (!active || isAbortError(error)) return;
        active = false;
        setSnapshot(
          createSnapshot(LEADER_ELECTION_STATUS.Error, errorMessage(error)),
        );
      });
  };

  return {
    start,
    stop: async () => {
      active = false;
      abortController?.abort();
      releaseLock?.();
      releaseLock = null;
      setSnapshot(createSnapshot(LEADER_ELECTION_STATUS.Stopped));
      await requestPromise;
      requestPromise = null;
      abortController = null;
    },
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
