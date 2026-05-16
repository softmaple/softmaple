import type { EventId } from "../../types";
import { MaxHeap } from "./max-heap";

/**
 * Bit flags used by `diffVersions` to colour events while running the
 * priority-queue diff. `LEFT` means "reachable from the left frontier",
 * `RIGHT` means "reachable from the right frontier", and
 * `COMMON = LEFT | RIGHT` means the event is a shared ancestor.
 */
const DIFF_COLOR = {
  LEFT: 1,
  RIGHT: 2,
  COMMON: 3,
} as const;

interface DiffVersionsView {
  readonly getParents: (id: EventId) => ReadonlySet<EventId>;
  readonly hasEvent: (id: EventId) => boolean;
  readonly insertionRankOf: (id: EventId) => number | undefined;
}

/**
 * Compute Appendix B's transitive version diff.
 *
 * Uses a local, merge-base style traversal instead of expanding both versions
 * to their full causal sets. Events from both frontiers are coloured (`LEFT`,
 * `RIGHT`, or `COMMON`) and walked toward their ancestors in descending
 * topological order via a max-heap keyed by insertion rank. Each event has
 * its colour merged with the colours of its visited descendants, so once an
 * event is popped its final colour is known and it can be classified into
 * `onlyInLeft`, `onlyInRight`, or discarded as common.
 *
 * Traversal terminates as soon as every event still in the heap has been
 * resolved to `COMMON`, which means the divergent region has been fully
 * enumerated and any remaining ancestors are guaranteed to be shared. For a
 * deep linear history with a small divergent branch this avoids touching
 * unrelated history, replacing a full-expansion O(|history|) walk with cost
 * proportional to the diff region.
 */
export const diffVersions = (
  left: ReadonlySet<EventId>,
  right: ReadonlySet<EventId>,
  view: DiffVersionsView,
): {
  readonly onlyInLeft: Set<EventId>;
  readonly onlyInRight: Set<EventId>;
} => {
  const onlyInLeft = new Set<EventId>();
  const onlyInRight = new Set<EventId>();

  const color = new Map<EventId, number>();
  const heap = new MaxHeap<EventId>(
    (a, b) => (view.insertionRankOf(a) ?? -1) - (view.insertionRankOf(b) ?? -1),
  );

  /**
   * Count of events currently in the heap whose colour is not yet `COMMON`.
   * Once this drops to zero, every remaining heap entry is a common ancestor
   * and its own ancestors must be common as well, so the traversal can
   * terminate early.
   */
  let pendingDivergent = 0;

  const paint = (id: EventId, addedColor: number): void => {
    if (!view.hasEvent(id)) {
      return;
    }
    const existing = color.get(id) ?? 0;
    const merged = existing | addedColor;
    if (merged === existing) {
      return;
    }
    color.set(id, merged);
    if (existing === 0) {
      heap.push(id);
      if (merged !== DIFF_COLOR.COMMON) {
        pendingDivergent++;
      }
    } else if (existing !== DIFF_COLOR.COMMON && merged === DIFF_COLOR.COMMON) {
      // The event was queued as divergent earlier but a second-frontier
      // descendant has just revealed that it is in fact common. It is still
      // in the heap, so adjust the divergent counter without pushing a
      // duplicate entry.
      pendingDivergent--;
    }
  };

  for (const id of left) {
    paint(id, DIFF_COLOR.LEFT);
  }
  for (const id of right) {
    paint(id, DIFF_COLOR.RIGHT);
  }

  while (heap.size > 0 && pendingDivergent > 0) {
    const id = heap.pop()!;
    const finalColor = color.get(id) ?? 0;

    if (finalColor === DIFF_COLOR.LEFT) {
      onlyInLeft.add(id);
      pendingDivergent--;
    } else if (finalColor === DIFF_COLOR.RIGHT) {
      onlyInRight.add(id);
      pendingDivergent--;
    }
    // COMMON events fall through; their colour is still propagated to
    // ancestors below so that ancestors reachable only through this path are
    // also marked as common rather than being mis-classified as one-sided.

    for (const parent of view.getParents(id)) {
      paint(parent, finalColor);
    }
  }

  return { onlyInLeft, onlyInRight };
};
