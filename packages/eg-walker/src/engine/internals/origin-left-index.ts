import type { AugmentedCRDTItem, ItemKey } from "./engine-types";

type OriginLeftRefs = ItemKey | ItemKey[];

/**
 * Reverse index: `target item` -> items whose `originLeft` points at it.
 * Maintained alongside the engine's item table so that
 * `RecordSplitter.splitRecordAt` can cheaply rewrite the `originLeft`
 * references when it carves a record in two. Without this rewrite the YATA
 * integration scan would see siblings anchored to the same logical boundary
 * as if they had different origins, which breaks partial replay convergence.
 *
 * The index also lets `applyInsert`'s typed-run coalescing branch
 * cheaply ask "does anyone anchor on this record's right boundary?":
 * extending such a record would shift the boundary that those
 * neighbours chose as their `originLeft`, so the coalescing path must
 * back off and place a fresh item instead.
 *
 * Item keys are dense, so the index is an array indexed by target key.
 */
export class OriginLeftIndex {
  private refs: Array<OriginLeftRefs | undefined> = [];

  clear(): void {
    this.refs = [];
  }

  /**
   * Register a newly allocated record once per index lifetime, in amortized
   * O(1). Inserts and split halves have fresh keys; snapshot restore clears
   * the index before registering each restored record. Later origin changes
   * must go through rewriteReferences, not another call to track.
   */
  track(itemId: ItemKey, originLeft: ItemKey | null): void {
    if (originLeft === null) {
      return;
    }
    const refs = this.refs[originLeft];
    if (refs === undefined) {
      this.refs[originLeft] = itemId;
      return;
    }
    if (typeof refs === "number") {
      if (refs !== itemId) {
        this.refs[originLeft] = [refs, itemId];
      }
      return;
    }
    refs.push(itemId);
  }

  has(itemId: ItemKey): boolean {
    const refs = this.refs[itemId];
    return refs !== undefined && (typeof refs === "number" || refs.length > 0);
  }

  /** Move k references in O(k) amortized work, preserving existing targets. */
  rewriteReferences(
    oldOriginLeft: ItemKey,
    newOriginLeft: ItemKey,
    itemAt: (itemId: ItemKey) => AugmentedCRDTItem | undefined,
  ): void {
    const refs = this.refs[oldOriginLeft];
    if (refs === undefined) {
      return;
    }
    this.refs[oldOriginLeft] = undefined;
    const merged = this.refs[newOriginLeft];
    const next: ItemKey[] =
      merged === undefined
        ? []
        : typeof merged === "number"
          ? [merged]
          : merged;
    const moved = typeof refs === "number" ? [refs] : refs;
    for (const itemId of moved) {
      const item = itemAt(itemId);
      if (!item || item.originLeft !== oldOriginLeft) {
        continue;
      }
      item.originLeft = newOriginLeft;
      // Each record is registered once and has one left origin, so the
      // moved and existing target references are disjoint. The arrays are
      // private to this index: append without scanning or copying the target.
      next.push(itemId);
    }
    if (next.length === 1) {
      this.refs[newOriginLeft] = next[0]!;
      return;
    }
    if (next.length > 1) {
      this.refs[newOriginLeft] = next;
    }
  }
}
