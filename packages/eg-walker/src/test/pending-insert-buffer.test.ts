import { describe, expect, it, vi } from "vitest";
import { PendingInsertBuffer } from "../engine/internals/pending-insert-buffer";

describe("PendingInsertBuffer", () => {
  describe("isEmpty / reset", () => {
    it("starts empty", () => {
      const buffer = new PendingInsertBuffer();
      expect(buffer.isEmpty()).toBe(true);
    });

    it("reports non-empty after an append seeds a span", () => {
      const buffer = new PendingInsertBuffer();
      buffer.append(5, "a", vi.fn());
      expect(buffer.isEmpty()).toBe(false);
    });

    it("reset() drops the current span without calling onFlush", () => {
      const buffer = new PendingInsertBuffer();
      const onFlush = vi.fn();
      buffer.append(5, "a", onFlush);
      buffer.reset();
      expect(buffer.isEmpty()).toBe(true);
      expect(onFlush).not.toHaveBeenCalled();
    });
  });

  describe("contiguous extension", () => {
    it("does not invoke onFlush when the next call extends the current span", () => {
      const buffer = new PendingInsertBuffer();
      const onFlush = vi.fn();
      buffer.append(5, "a", onFlush);
      buffer.append(6, "b", onFlush);
      buffer.append(7, "c", onFlush);
      expect(onFlush).not.toHaveBeenCalled();
    });

    it("flushes the coalesced span as one call at the original effect index", () => {
      const buffer = new PendingInsertBuffer();
      const onFlush = vi.fn();
      buffer.append(5, "a", onFlush);
      buffer.append(6, "b", onFlush);
      buffer.append(7, "c", onFlush);
      buffer.flush(onFlush);
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith(5, "abc");
    });
  });

  describe("non-contiguous append (defensive flush)", () => {
    it("flushes the prior span before seeding a new one", () => {
      const buffer = new PendingInsertBuffer();
      const onFlush = vi.fn();
      buffer.append(5, "a", onFlush);
      buffer.append(6, "b", onFlush);
      // Jumps to an unrelated index — the buffer must flush the "ab" span
      // before adopting the new one, so the engine doesn't strand bytes at
      // the previous offset.
      buffer.append(100, "z", onFlush);
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith(5, "ab");
    });

    it("retains the new span after the defensive flush", () => {
      const buffer = new PendingInsertBuffer();
      const onFlush = vi.fn();
      buffer.append(5, "a", onFlush);
      buffer.append(100, "z", onFlush);
      const finalFlush = vi.fn();
      buffer.flush(finalFlush);
      expect(finalFlush).toHaveBeenCalledTimes(1);
      expect(finalFlush).toHaveBeenCalledWith(100, "z");
    });

    it("treats a gap of one as non-contiguous", () => {
      const buffer = new PendingInsertBuffer();
      const onFlush = vi.fn();
      buffer.append(5, "a", onFlush);
      // After "a" at index 5, the next contiguous slot is 6. Index 7 is
      // a gap of one and must trigger the defensive flush.
      buffer.append(7, "b", onFlush);
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith(5, "a");
    });
  });

  describe("flush()", () => {
    it("is a no-op when the buffer is empty", () => {
      const buffer = new PendingInsertBuffer();
      const onFlush = vi.fn();
      buffer.flush(onFlush);
      expect(onFlush).not.toHaveBeenCalled();
    });

    it("leaves the buffer empty after draining", () => {
      const buffer = new PendingInsertBuffer();
      buffer.append(5, "a", vi.fn());
      buffer.flush(vi.fn());
      expect(buffer.isEmpty()).toBe(true);
    });

    it("a second flush on an already-drained buffer is a no-op", () => {
      const buffer = new PendingInsertBuffer();
      buffer.append(5, "a", vi.fn());
      buffer.flush(vi.fn());
      const secondFlush = vi.fn();
      buffer.flush(secondFlush);
      expect(secondFlush).not.toHaveBeenCalled();
    });
  });

  describe("reentrancy invariant", () => {
    it("clears its own state before invoking onFlush so a reentrant flush short-circuits", () => {
      const buffer = new PendingInsertBuffer();
      const reentrantFlush = vi.fn();
      let seenEmpty: boolean | null = null;
      buffer.append(5, "a", vi.fn());
      buffer.flush((effectIndex, text) => {
        // While inside the callback, the buffer must already report empty
        // and a reentrant flush must not re-deliver the same span.
        seenEmpty = buffer.isEmpty();
        buffer.flush(reentrantFlush);
        expect(effectIndex).toBe(5);
        expect(text).toBe("a");
      });
      expect(seenEmpty).toBe(true);
      expect(reentrantFlush).not.toHaveBeenCalled();
    });

    it("append's defensive flush also clears state before invoking onFlush", () => {
      const buffer = new PendingInsertBuffer();
      let seenEmptyDuringFlush: boolean | null = null;
      buffer.append(5, "a", vi.fn());
      buffer.append(100, "z", () => {
        seenEmptyDuringFlush = buffer.isEmpty();
      });
      expect(seenEmptyDuringFlush).toBe(true);
      // The new span seeded after the defensive flush is still pending.
      expect(buffer.isEmpty()).toBe(false);
    });
  });
});
