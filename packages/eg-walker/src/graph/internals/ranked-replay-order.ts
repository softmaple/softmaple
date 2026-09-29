import type { EventId } from "../../types";
import { compareEventIds } from "../event-id";

export interface RankedReplayOrderView {
  eventCount(): number;
  insertionRankOf(id: EventId): number | undefined;
  eventIdAt(rank: number): EventId | undefined;
  forEachParentRank(rank: number, visit: (parentRank: number) => void): void;
  forEachChildRank(rank: number, visit: (childRank: number) => void): void;
}

/**
 * Branch-preserving topological order for an object-backed replay suffix.
 *
 * The generic path builds three string-keyed Maps plus cloned GraphEvents.
 * This workspace marks the suffix in dense insertion-rank columns and reuses
 * those columns across partial replays. Only touched ranks are cleared, so the
 * work and reset cost remain proportional to the divergent suffix.
 */
export class RankedReplayOrderWorkspace {
  private membership = new Uint8Array(0);
  private remainingParents = new Uint32Array(0);
  private readonly touchedRanks: number[] = [];
  private readonly roots: number[] = [];
  private readonly stack: number[] = [];
  private readonly newlyReady: number[] = [];

  release(): void {
    this.membership = new Uint8Array(0);
    this.remainingParents = new Uint32Array(0);
    this.resetScratch();
  }

  order(
    replayEventIds: ReadonlySet<EventId>,
    view: RankedReplayOrderView,
  ): ReadonlyArray<EventId> {
    this.ensureCapacity(view.eventCount());
    try {
      for (const eventId of replayEventIds) {
        const rank = view.insertionRankOf(eventId);
        if (rank === undefined) {
          throw new Error(`Missing replay event in graph: ${eventId}`);
        }
        this.addMember(rank, 0);
      }
      return this.orderMembers(view, 0).map((rank) =>
        requireEventIdAt(view, rank),
      );
    } finally {
      this.clearMembers(0);
    }
  }

  /**
   * Order the events at insertion ranks `[start, end)`, returning ranks.
   *
   * The columns are indexed from `start`, so ordering a short suffix of a long
   * history does not allocate columns for the whole graph.
   */
  orderRange(
    start: number,
    end: number,
    view: RankedReplayOrderView,
  ): ReadonlyArray<number> {
    this.ensureCapacity(end - start);
    try {
      for (let rank = start; rank < end; rank++) {
        this.addMember(rank, start);
      }
      return this.orderMembers(view, start);
    } finally {
      this.clearMembers(start);
    }
  }

  /** Mark `rank` as a member, in the column at `rank - offset`. */
  private addMember(rank: number, offset: number): void {
    if (this.membership[rank - offset] !== 0) {
      return;
    }
    this.membership[rank - offset] = 1;
    this.touchedRanks.push(rank);
  }

  private orderMembers(view: RankedReplayOrderView, offset: number): number[] {
    const ordered: number[] = [];
    // Parents and children of members may fall outside the columns.
    const isMember = (rank: number): boolean => {
      const column = rank - offset;
      return (
        column >= 0 &&
        column < this.membership.length &&
        this.membership[column] === 1
      );
    };
    let parentCount = 0;
    const countParent = (parentRank: number): void => {
      if (isMember(parentRank)) {
        parentCount++;
      }
    };

    for (const rank of this.touchedRanks) {
      parentCount = 0;
      view.forEachParentRank(rank, countParent);
      this.remainingParents[rank - offset] = parentCount;
      if (parentCount === 0) {
        this.roots.push(rank);
      }
    }

    const compareRanks = (left: number, right: number): number =>
      compareEventIds(
        requireEventIdAt(view, left),
        requireEventIdAt(view, right),
      );
    this.roots.sort(compareRanks);
    for (let index = this.roots.length - 1; index >= 0; index--) {
      this.stack.push(this.roots[index]!);
    }

    const visitChild = (childRank: number): void => {
      if (!isMember(childRank)) {
        return;
      }
      const remaining = this.remainingParents[childRank - offset]! - 1;
      this.remainingParents[childRank - offset] = remaining;
      if (remaining === 0) {
        this.newlyReady.push(childRank);
      }
    };

    while (this.stack.length > 0) {
      const rank = this.stack.pop()!;
      if (!isMember(rank)) {
        continue;
      }
      this.membership[rank - offset] = 2;
      ordered.push(rank);

      this.newlyReady.length = 0;
      view.forEachChildRank(rank, visitChild);
      if (this.newlyReady.length > 1) {
        this.newlyReady.sort(compareRanks);
      }
      for (let index = this.newlyReady.length - 1; index >= 0; index--) {
        this.stack.push(this.newlyReady[index]!);
      }
    }

    if (ordered.length !== this.touchedRanks.length) {
      throw new Error("Cycle detected in partial replay suffix");
    }
    return ordered;
  }

  private clearMembers(offset: number): void {
    for (const rank of this.touchedRanks) {
      this.membership[rank - offset] = 0;
      this.remainingParents[rank - offset] = 0;
    }
    this.resetScratch();
  }

  private ensureCapacity(eventCount: number): void {
    if (this.membership.length >= eventCount) {
      return;
    }
    let capacity = Math.max(16, this.membership.length);
    while (capacity < eventCount) {
      capacity *= 2;
    }
    this.membership = new Uint8Array(capacity);
    this.remainingParents = new Uint32Array(capacity);
  }

  private resetScratch(): void {
    this.touchedRanks.length = 0;
    this.roots.length = 0;
    this.stack.length = 0;
    this.newlyReady.length = 0;
  }
}

const requireEventIdAt = (
  view: RankedReplayOrderView,
  rank: number,
): EventId => {
  const eventId = view.eventIdAt(rank);
  if (eventId === undefined) {
    throw new Error(`Event graph is missing insertion rank ${rank}`);
  }
  return eventId;
};
