import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_BATCH_ID,
  BOOTSTRAP_EVENT_ID,
  WireBatchSchema,
} from "./batch";

describe("WireBatchSchema bootstrap exception", () => {
  it("accepts the canonical bootstrap batch", () => {
    const parsed = WireBatchSchema.parse({
      schemaVersion: 1,
      batchId: BOOTSTRAP_BATCH_ID,
      parentVersion: [],
      events: [
        {
          schemaVersion: 1,
          id: BOOTSTRAP_EVENT_ID,
          parentVersion: [],
        },
      ],
    });
    expect(parsed.batchId).toBe(BOOTSTRAP_BATCH_ID);
  });

  it("rejects bootstrap-ID batches with non-empty parents", () => {
    const result = WireBatchSchema.safeParse({
      schemaVersion: 1,
      batchId: BOOTSTRAP_BATCH_ID,
      parentVersion: ["other:1"],
      events: [
        {
          schemaVersion: 1,
          id: BOOTSTRAP_EVENT_ID,
          parentVersion: ["other:1"],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects bootstrap-ID batches whose first event is not the bootstrap event", () => {
    const result = WireBatchSchema.safeParse({
      schemaVersion: 1,
      batchId: BOOTSTRAP_BATCH_ID,
      parentVersion: [],
      events: [
        {
          schemaVersion: 1,
          id: "replica:1",
          parentVersion: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
