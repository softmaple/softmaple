import Dexie, { type Table } from "dexie";
import type { WireBatch } from "@softmaple/collab-protocol";

export interface StoredBatchRow {
  readonly key: string;
  readonly documentId: string;
  readonly batchId: string;
  readonly batch: WireBatch;
  readonly durable: boolean;
  readonly createdAt: number;
}

export interface StoredMetaRow {
  readonly documentId: string;
  readonly repairCursor: string | null;
  readonly updatedAt: number;
}

const rowKey = (documentId: string, batchId: string): string =>
  `${documentId}\0${batchId}`;

class CollabDatabase extends Dexie {
  batches!: Table<StoredBatchRow, string>;
  meta!: Table<StoredMetaRow, string>;

  constructor(databaseName: string) {
    super(databaseName);
    this.version(1).stores({
      // durable is filtered in memory; indexing booleans is unreliable in Dexie.
      batches: "key, documentId, batchId",
      meta: "documentId",
    });
  }
}

export interface CollabStorage {
  loadBatches(documentId: string): Promise<ReadonlyArray<StoredBatchRow>>;
  putBatch(
    documentId: string,
    batch: WireBatch,
    durable: boolean,
  ): Promise<void>;
  markDurable(
    documentId: string,
    batchIds: ReadonlyArray<string>,
  ): Promise<void>;
  getRepairCursor(documentId: string): Promise<string | null>;
  setRepairCursor(documentId: string, cursor: string | null): Promise<void>;
  getPendingBatchIds(documentId: string): Promise<ReadonlyArray<string>>;
  clearDocument(documentId: string): Promise<void>;
  close(): void;
}

export const createCollabStorage = (
  databaseName = "softmaple-collab-v1",
): CollabStorage => {
  const db = new CollabDatabase(databaseName);

  return {
    loadBatches: async (documentId) =>
      db.batches.where("documentId").equals(documentId).toArray(),

    putBatch: async (documentId, batch, durable) => {
      await db.transaction("rw", db.batches, async () => {
        const key = rowKey(documentId, batch.batchId);
        const existing = await db.batches.get(key);
        await db.batches.put({
          key,
          documentId,
          batchId: batch.batchId,
          batch,
          durable: existing?.durable === true ? true : durable,
          createdAt: existing?.createdAt ?? Date.now(),
        });
      });
    },

    markDurable: async (documentId, batchIds) => {
      await db.transaction("rw", db.batches, async () => {
        for (const batchId of batchIds) {
          const row = await db.batches.get(rowKey(documentId, batchId));
          if (!row || row.durable) continue;
          await db.batches.put({ ...row, durable: true });
        }
      });
    },

    getRepairCursor: async (documentId) => {
      const row = await db.meta.get(documentId);
      return row?.repairCursor ?? null;
    },

    setRepairCursor: async (documentId, cursor) => {
      await db.meta.put({
        documentId,
        repairCursor: cursor,
        updatedAt: Date.now(),
      });
    },

    getPendingBatchIds: async (documentId) => {
      const rows = await db.batches
        .where("documentId")
        .equals(documentId)
        .filter((row) => !row.durable)
        .toArray();
      return rows.map((row) => row.batchId);
    },

    clearDocument: async (documentId) => {
      await db.transaction("rw", db.batches, db.meta, async () => {
        await db.batches.where("documentId").equals(documentId).delete();
        await db.meta.delete(documentId);
      });
    },

    close: () => {
      db.close();
    },
  };
};
