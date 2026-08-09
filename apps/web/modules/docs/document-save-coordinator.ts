export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type CollaborationStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "error";

type PersistResult = "ack" | "empty";

/**
 * Serializes overlapping saves and ignores stale completions so an older
 * response cannot mark newer unsaved edits as saved.
 */
export const createSaveCoordinator = (
  onStatus: (status: SaveStatus) => void,
) => {
  let latestGeneration = 0;
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;

  const enqueue = (persist: () => Promise<PersistResult>): Promise<void> => {
    const generation = ++latestGeneration;
    if (!disposed) onStatus("saving");
    const run = async (): Promise<void> => {
      if (disposed) return;
      try {
        await persist();
        if (disposed) return;
        if (generation !== latestGeneration) return;
        onStatus("saved");
      } catch {
        if (!disposed && generation === latestGeneration) {
          onStatus("error");
        }
      }
    };
    queue = queue.then(run, run);
    return queue;
  };

  return {
    requestSave(persist: () => Promise<PersistResult>): void {
      if (disposed) return;
      void enqueue(persist);
    },
    flush(persist: () => Promise<PersistResult>): Promise<void> {
      if (disposed) return Promise.resolve();
      return enqueue(persist);
    },
    dispose(): void {
      disposed = true;
    },
  };
};

export type DocumentUiStatus =
  | "connecting"
  | "syncing"
  | "saving"
  | "saved"
  | "offline"
  | "error";

/**
 * Derive a single header label from orthogonal save + collaboration state.
 */
export const deriveDocumentUiStatus = ({
  collaborationStatus,
  saveStatus,
}: {
  readonly collaborationStatus: CollaborationStatus;
  readonly saveStatus: SaveStatus;
}): DocumentUiStatus => {
  if (collaborationStatus === "disabled") {
    if (saveStatus === "saving") return "saving";
    if (saveStatus === "error") return "error";
    return "saved";
  }
  if (collaborationStatus === "connecting") return "connecting";
  if (collaborationStatus === "reconnecting" || collaborationStatus === "offline") {
    return "offline";
  }
  if (collaborationStatus === "error") return "error";
  if (saveStatus === "saving") return "saving";
  if (saveStatus === "error") return "error";
  return "saved";
};
