/**
 * Buffered append for the typed-run coalescing path.
 *
 * The coalescing branch in `applyInsert` fires once per
 * single-character INSERT that extends an existing typed-run record.
 * The CRDT side is already O(1) (the record's `content` grows in place
 * and the ranked B-tree only re-weights one leaf), but a naive
 * implementation would also splice the resulting document text for
 * every coalesced keystroke. That allocates the entire document
 * string on each event, so a 20 000-event single-author linear trace
 * pays O(n^2) string work.
 *
 * Instead, we hold the appended text in {@link pendingText} and record
 * where it logically lives in the resulting document as
 * {@link pendingEffectIndex}. Consecutive coalesced events on the same
 * record extend `pendingText` by their single code unit, so a run of N
 * keystrokes costs O(N) in string work (V8 cons-string append) plus
 * one O(document length) splice at the end of the run.
 *
 * Invariant: when `pendingText.length > 0`, the conceptual resulting
 * text is
 *
 *   resultingText.slice(0, pendingEffectIndex)
 *     + pendingText
 *     + resultingText.slice(pendingEffectIndex)
 *
 * The owner must call {@link flush} (or accept the implicit flush
 * inside {@link append}) before any non-coalesced read or write of the
 * document text. The buffer never owns the document itself — it asks
 * the caller to materialise the deferred span via the {@link FlushFn}
 * callback so the engine remains the single writer of
 * `resultingText`.
 */

/**
 * Materialise a deferred span into the document. Called at most once
 * per {@link PendingInsertBuffer.flush} invocation, and at most once
 * per non-contiguous {@link PendingInsertBuffer.append} call.
 */
export type FlushFn = (effectIndex: number, text: string) => void;

export class PendingInsertBuffer {
  private pendingText = "";
  private pendingEffectIndex = 0;

  reset(): void {
    this.pendingText = "";
    this.pendingEffectIndex = 0;
  }

  isEmpty(): boolean {
    return this.pendingText.length === 0;
  }

  /**
   * Record a coalesced single-character insert.
   *
   * Consecutive calls whose {@link effectIndex} sits immediately after
   * the buffer's current span (i.e. the next code unit of the same
   * extending typed-run record) just extend {@link pendingText} —
   * {@link flush} is **not** invoked. Anything that lands elsewhere
   * invokes {@link flush} with the existing span first and then starts
   * a fresh span at the new index.
   *
   * The flush-and-restart branch below is defensive given the current
   * engine invariants: any event that would land at a non-contiguous
   * effect index goes through the non-coalescing path in `applyInsert`
   * (different replica, split origin, or non-empty conflict region),
   * which already flushes the buffer before this method is called
   * again. We still handle it explicitly so a future change that
   * widens the coalescing branch (e.g. extending across a split-on-demand
   * boundary) can't silently corrupt the document by stranding bytes at
   * the previous offset.
   */
  append(effectIndex: number, text: string, onFlush: FlushFn): void {
    const buffered = this.pendingText;
    if (
      buffered.length > 0 &&
      effectIndex === this.pendingEffectIndex + buffered.length
    ) {
      this.pendingText = buffered + text;
      return;
    }
    if (buffered.length > 0) {
      const flushIndex = this.pendingEffectIndex;
      const flushText = this.pendingText;
      // Clear the buffer *before* invoking the callback so that a
      // reentrant `isEmpty` / `flush` from inside the callback sees a
      // clean buffer and short-circuits instead of double-applying.
      this.pendingText = "";
      this.pendingEffectIndex = 0;
      onFlush(flushIndex, flushText);
    }
    this.pendingText = text;
    this.pendingEffectIndex = effectIndex;
  }

  /**
   * Drain any buffered typed-run append by handing it to {@link flush}.
   *
   * No-op when the buffer is empty, so cold call sites (`generate`
   * return, `applyEvent` return, `getText`, `reset`) don't need to
   * repeat the {@link isEmpty} check inline. Hot per-event call sites
   * (`applyInsert` non-coalesced, top of `applyDelete`) can hoist
   * {@link isEmpty} to skip even the function call when the buffer is
   * empty.
   *
   * After this call the document the caller maintains matches the
   * logical document the rest of the engine reasons about (the
   * concatenation of every effect-visible CRDT record's `content` in
   * sequence order), so concurrent inserts, deletes, and external
   * readers can splice / slice it without correcting for the deferred
   * span.
   */
  flush(onFlush: FlushFn): void {
    if (this.pendingText.length === 0) {
      return;
    }
    const index = this.pendingEffectIndex;
    const text = this.pendingText;
    this.pendingText = "";
    this.pendingEffectIndex = 0;
    onFlush(index, text);
  }
}
