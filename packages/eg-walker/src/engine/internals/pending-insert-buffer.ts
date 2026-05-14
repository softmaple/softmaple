import { spliceText } from "./text-utils";

/**
 * Buffered append for the typed-run coalescing path.
 *
 * The coalescing branch in `applyInsert` fires once per
 * single-character INSERT that extends an existing typed-run record.
 * The CRDT side is already O(1) (the record's `content` grows in place
 * and the ranked B-tree only re-weights one leaf), but a naive
 * implementation would also call {@link spliceText} on the resulting
 * document for every coalesced keystroke. That allocates the entire
 * document string on each event, so a 20 000-event single-author
 * linear trace pays O(n^2) string work.
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
 * {@link flushInto} materialises this into the supplied `resultingText`
 * and must be called eagerly before any non-coalesced read or write of
 * the document text.
 */
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
   * Record a coalesced single-character insert in the typed-run buffer.
   *
   * Consecutive calls whose {@link effectIndex} sits immediately after
   * the buffer's current span (i.e. the next code unit of the same
   * extending typed-run record) just extend {@link pendingText}.
   * Anything that lands elsewhere flushes the buffer first and starts a
   * fresh span at the new index. The buffer is later drained by
   * {@link flushInto} before any non-coalesced read or write of the
   * document text.
   *
   * The flush-and-restart branch below is defensive given the current
   * engine invariants: any event that would land at a non-contiguous
   * effect index goes through the non-coalescing path in `applyInsert`
   * (different replica, split origin, or non-empty conflict region),
   * which flushes the buffer before this method is called again. We
   * still handle it explicitly so a future change that widens the
   * coalescing branch (e.g. extending across a split-on-demand
   * boundary) can't silently corrupt the document by stranding bytes at
   * the previous offset.
   *
   * Returns the document text after any defensive flush triggered by a
   * non-contiguous call; returns `resultingText` unchanged in the
   * common contiguous-extension case.
   */
  append(resultingText: string, effectIndex: number, text: string): string {
    const buffered = this.pendingText;
    if (
      buffered.length > 0 &&
      effectIndex === this.pendingEffectIndex + buffered.length
    ) {
      this.pendingText = buffered + text;
      return resultingText;
    }
    let nextResultingText = resultingText;
    if (buffered.length > 0) {
      nextResultingText = this.flushInto(resultingText);
    }
    this.pendingText = text;
    this.pendingEffectIndex = effectIndex;
    return nextResultingText;
  }

  /**
   * Drain any buffered typed-run append into `resultingText`.
   *
   * Safe to call unconditionally: the empty-buffer early-out makes the
   * call cheap when there is nothing pending, so cold call sites
   * (`generate` return, `applyEvent` return, `getText`, `reset`) don't
   * need to repeat the check inline. Hot per-event call sites
   * (`applyInsert` non-coalesced, top of `applyDelete`) can hoist
   * {@link isEmpty} to skip even the function call when the buffer is
   * empty.
   *
   * After this call the returned text matches the logical document the
   * rest of the engine reasons about (the concatenation of every
   * effect-visible CRDT record's `content` in sequence order), so
   * concurrent inserts, deletes, and external readers can splice /
   * slice it without correcting for the deferred span.
   */
  flushInto(resultingText: string): string {
    if (this.pendingText.length === 0) {
      return resultingText;
    }
    const next = spliceText(
      resultingText,
      this.pendingEffectIndex,
      this.pendingText,
    );
    this.pendingText = "";
    this.pendingEffectIndex = 0;
    return next;
  }
}
