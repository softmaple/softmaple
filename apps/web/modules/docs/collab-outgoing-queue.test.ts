import { describe, expect, it, vi } from "vitest";
import { createOutgoingBatchQueue } from "@/modules/docs/collab-outgoing-queue";

describe("createOutgoingBatchQueue", () => {
  it("sends only one causally dependent chunk while a write is in flight", () => {
    const sent: string[][] = [];
    const queue = createOutgoingBatchQueue({
      maxBatchesPerSend: 2,
      send: (batches) => {
        sent.push(batches.map((batch) => batch.batchId));
        return true;
      },
    });

    expect(
      queue.enqueue([
        { batchId: "a" },
        { batchId: "b" },
        { batchId: "c" },
      ]),
    ).toBe(true);
    expect(sent).toEqual([["a", "b"]]);
    expect(queue.inFlightSize()).toBe(2);
    expect(queue.pendingSize()).toBe(3);

    // Rapid follow-up edits must not open a second concurrent durable write.
    expect(queue.enqueue([{ batchId: "d" }])).toBe(false);
    expect(sent).toEqual([["a", "b"]]);

    expect(queue.acknowledge(["a", "b"])).toBe(true);
    expect(sent).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(queue.acknowledge(["c", "d"])).toBe(false);
    expect(queue.hasPending()).toBe(false);
    expect(queue.hasInFlight()).toBe(false);
  });

  it("keeps batch identity across disconnect and exact resend", () => {
    const sent: string[][] = [];
    const queue = createOutgoingBatchQueue({
      maxBatchesPerSend: 64,
      send: (batches) => {
        sent.push(batches.map((batch) => batch.batchId));
        return true;
      },
    });

    const first = { batchId: "batch-1", payload: "one" };
    queue.enqueue([first]);
    expect(sent).toEqual([["batch-1"]]);

    // Disconnect before DurableAck: clear in-flight, keep pending payload.
    queue.resetInFlight();
    expect(queue.hasInFlight()).toBe(false);
    expect(queue.peekPending()).toEqual([first]);

    expect(queue.flush()).toBe(true);
    expect(sent).toEqual([["batch-1"], ["batch-1"]]);
    expect(queue.peekPending()[0]).toBe(first);
  });

  it("does not mark batches in-flight when send fails", () => {
    const send = vi.fn(() => false);
    const queue = createOutgoingBatchQueue({
      maxBatchesPerSend: 64,
      send,
    });

    expect(queue.enqueue([{ batchId: "a" }])).toBe(false);
    expect(queue.hasInFlight()).toBe(false);
    expect(queue.pendingSize()).toBe(1);
  });

  it("tracks pending batches with add without opening a durable write", () => {
    const send = vi.fn(() => true);
    const queue = createOutgoingBatchQueue({
      maxBatchesPerSend: 64,
      send,
    });

    queue.add([{ batchId: "a" }, { batchId: "b" }]);
    expect(send).not.toHaveBeenCalled();
    expect(queue.pendingSize()).toBe(2);
    expect(queue.flush()).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
