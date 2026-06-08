import type { EventId } from "../../types";
import type { AugmentedCRDTItem } from "./engine-types";

type OriginLeftRefs = EventId | Set<EventId>;

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
  private readonly refs = new Map<EventId, OriginLeftRefs>();

  clear(): void {
    this.refs.clear();
  }

  track(itemId: EventId, originLeft: EventId | null): void {
    if (originLeft === null) {
      return;
    }
    const refs = this.refs.get(originLeft);
    if (refs === undefined) {
      this.refs.set(originLeft, itemId);
      return;
    }
    if (typeof refs === "string") {
      if (refs !== itemId) {
        this.refs.set(originLeft, new Set([refs, itemId]));
      }
      return;
    }
    refs.add(itemId);
  }

  has(itemId: EventId): boolean {
    const refs = this.refs.get(itemId);
    return refs !== undefined && (typeof refs === "string" || refs.size > 0);
  }

  rewriteReferences(
    oldOriginLeft: EventId,
    newOriginLeft: EventId,
    itemsById: ReadonlyMap<EventId, AugmentedCRDTItem>,
  ): void {
    const refs = this.refs.get(oldOriginLeft);
    if (refs === undefined) {
      return;
    }
    this.refs.delete(oldOriginLeft);
    const merged = this.refs.get(newOriginLeft);
    const next = new Set<EventId>(
      merged === undefined
        ? []
        : typeof merged === "string"
          ? [merged]
          : merged,
    );
    for (const itemId of refsToIterable(refs)) {
      const item = itemsById.get(itemId);
      if (!item || item.originLeft !== oldOriginLeft) {
        continue;
      }
      item.originLeft = newOriginLeft;
      next.add(itemId);
    }
    if (next.size === 1) {
      const [only] = next;
      if (only !== undefined) {
        this.refs.set(newOriginLeft, only);
      }
      return;
    }
    if (next.size > 1) {
      this.refs.set(newOriginLeft, next);
    }
  }
}

const refsToIterable = (refs: OriginLeftRefs): Iterable<EventId> =>
  typeof refs === "string" ? [refs] : refs;
