import { describe, expect, it, vi } from "vitest";
import { createDurableObjectRoomFanout } from "../src/do-capabilities";

describe("Durable Object room fanout", () => {
  it("isolates a rejected subscriber from the remaining handlers", async () => {
    const fanout = createDurableObjectRoomFanout();
    const rejected = vi.fn(async () => {
      throw new Error("subscriber failed");
    });
    const delivered = vi.fn();
    await fanout.subscribe("document-id", rejected);
    await fanout.subscribe("document-id", delivered);

    const event = { batches: [], documentId: "document-id" };
    await expect(fanout.publish(event)).resolves.toBeUndefined();
    expect(rejected).toHaveBeenCalledWith(event);
    expect(delivered).toHaveBeenCalledWith(event);
  });
});
