import type { EventId } from "../../types";
import type { AugmentedCRDTItem } from "./engine-types";

/**
 * Reverse index: `target item id` -> set of item ids whose `originLeft`
 * points at it. Maintained alongside the engine's `itemsById` map so
 * that `RecordSplitter.splitRecordAt` can cheaply rewrite the
 * `originLeft` references when it carves a placeholder in two. Without
 * this rewrite the YATA integration scan would see siblings anchored
 * to the same logical boundary as if they had different origins, which
 * breaks partial replay convergence.
 *
 * The index also lets `applyInsert`'s typed-run coalescing branch
 * cheaply ask "does anyone anchor on this record's right boundary?":
 * extending such a record would shift the boundary that those
 * neighbours chose as their `originLeft`, so the coalescing path must
 * back off and place a fresh item instead.
 */
export class OriginLeftIndex {
  private readonly refs = new Map<EventId, Set<EventId>>();

  clear(): void {
    this.refs.clear();
  }

  track(itemId: EventId, originLeft: EventId | null): void {
    if (originLeft === null) {
      return;
    }
    const set = this.refs.get(originLeft) ?? new Set<EventId>();
    set.add(itemId);
    this.refs.set(originLeft, set);
  }

  has(itemId: EventId): boolean {
    const refs = this.refs.get(itemId);
    return refs !== undefined && refs.size > 0;
  }

  rewriteReferences(
    oldOriginLeft: EventId,
    newOriginLeft: EventId,
    itemsById: ReadonlyMap<EventId, AugmentedCRDTItem>,
  ): void {
    const refs = this.refs.get(oldOriginLeft);
    if (!refs || refs.size === 0) {
      return;
    }
    this.refs.delete(oldOriginLeft);
    const merged = this.refs.get(newOriginLeft) ?? new Set<EventId>();
    for (const itemId of refs) {
      const item = itemsById.get(itemId);
      if (!item || item.originLeft !== oldOriginLeft) {
        continue;
      }
      item.originLeft = newOriginLeft;
      merged.add(itemId);
    }
    if (merged.size > 0) {
      this.refs.set(newOriginLeft, merged);
    }
  }
}
