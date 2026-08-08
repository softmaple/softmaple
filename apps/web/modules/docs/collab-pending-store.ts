import {
  parseRichTextEventBatch,
  type RichTextEventBatch,
} from "@softmaple/block-model";

const STORAGE_VERSION = 2 as const;
const STORAGE_KEY_PREFIX = `softmaple:collab-pending:v${STORAGE_VERSION}:`;

interface PendingBatchEnvelope {
  readonly version: typeof STORAGE_VERSION;
  readonly batches: ReadonlyArray<RichTextEventBatch>;
}

const storageKey = (documentId: string, userId: string): string =>
  `${STORAGE_KEY_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(documentId)}`;

const parseEnvelope = (storage: Storage, key: string): PendingBatchEnvelope => {
  const value = storage.getItem(key);
  if (value === null) {
    return { version: STORAGE_VERSION, batches: [] };
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("Pending collaboration data must be an object");
    }
    const envelope = parsed as Record<string, unknown>;
    if (
      envelope.version !== STORAGE_VERSION ||
      !Array.isArray(envelope.batches)
    ) {
      throw new Error("Unsupported pending collaboration data version");
    }

    return {
      version: STORAGE_VERSION,
      batches: envelope.batches.map(parseRichTextEventBatch),
    };
  } catch (error) {
    try {
      storage.removeItem(key);
    } catch {
      // Preserve the parse or validation error that made the entry unusable.
    }
    throw error;
  }
};

const writeEnvelope = (
  storage: Storage,
  documentId: string,
  userId: string,
  batches: ReadonlyArray<RichTextEventBatch>,
): void => {
  const key = storageKey(documentId, userId);
  if (batches.length === 0) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(
    key,
    JSON.stringify({
      version: STORAGE_VERSION,
      batches,
    } satisfies PendingBatchEnvelope),
  );
};

export const loadPendingBatches = (
  storage: Storage,
  documentId: string,
  userId: string,
): ReadonlyArray<RichTextEventBatch> => {
  const key = storageKey(documentId, userId);
  return parseEnvelope(storage, key).batches;
};

export const addPendingBatches = (
  storage: Storage,
  documentId: string,
  userId: string,
  batches: ReadonlyArray<RichTextEventBatch>,
): ReadonlyArray<RichTextEventBatch> => {
  if (batches.length === 0) {
    return loadPendingBatches(storage, documentId, userId);
  }

  const merged = new Map(
    loadPendingBatches(storage, documentId, userId).map(
      (batch) => [batch.batchId, batch] as const,
    ),
  );
  for (const batch of batches) merged.set(batch.batchId, batch);
  const nextBatches = [...merged.values()];
  writeEnvelope(storage, documentId, userId, nextBatches);
  return nextBatches;
};

export const acknowledgePendingBatches = (
  storage: Storage,
  documentId: string,
  userId: string,
  batchIds: ReadonlyArray<string>,
): ReadonlyArray<RichTextEventBatch> => {
  const acknowledged = new Set(batchIds);
  const nextBatches = loadPendingBatches(storage, documentId, userId).filter(
    (batch) => !acknowledged.has(batch.batchId),
  );
  writeEnvelope(storage, documentId, userId, nextBatches);
  return nextBatches;
};
