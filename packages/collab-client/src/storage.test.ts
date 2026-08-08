import { describe, expect, it } from "vitest";
import { createCollabStorage } from "./storage";

const batch = {
  schemaVersion: 1,
  batchId: "r:1",
  parentVersion: ["softmaple:block-model:bootstrap:event:v1"],
  events: [
    {
      schemaVersion: 1,
      id: "r:1",
      parentVersion: ["softmaple:block-model:bootstrap:event:v1"],
    },
  ],
};

describe("createCollabStorage", () => {
  it("persists batches, durable flags, and repair cursor", async () => {
    const storage = createCollabStorage(`test-${crypto.randomUUID()}`);
    const documentId = "11111111-1111-4111-8111-111111111111";

    await storage.putBatch(documentId, batch, false);
    await storage.setRepairCursor(documentId, "42");

    const loaded = await storage.loadBatches(documentId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.durable).toBe(false);
    expect(await storage.getPendingBatchIds(documentId)).toEqual(["r:1"]);

    await storage.markDurable(documentId, ["r:1"]);
    expect(await storage.getPendingBatchIds(documentId)).toEqual([]);
    expect(await storage.getRepairCursor(documentId)).toBe("42");

    storage.close();
  });
});
