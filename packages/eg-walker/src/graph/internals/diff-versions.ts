import type { EventId } from "../../types";
import { MaxHeap } from "./max-heap";

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

    for (const parent of view.getParents(id)) {
      paint(parent, finalColor);
    }
  }

  return { onlyInLeft, onlyInRight };
};
