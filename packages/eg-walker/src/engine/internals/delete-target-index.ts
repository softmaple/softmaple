import type { EventId } from "../../types";

export interface DeleteTargetRecord {
  readonly deleteEventId: EventId;
  readonly targetIds: ReadonlyArray<EventId>;
}

export interface CompactDeleteTargetRecords {
  readonly idTable: ReadonlyArray<EventId>;
  readonly deleteEventRefs: Uint32Array;
  readonly targetOffsets: Uint32Array;
  readonly targetRefs: Uint32Array;
}

export type DeleteTargetRefs = EventId | ReadonlyArray<EventId>;

type StoredDeleteTargets = EventId | EventId[];
type DeleteOwners = EventId | Set<EventId>;

export const recordsFromCompactDeleteTargets = (
  records: CompactDeleteTargetRecords,
): DeleteTargetRecord[] =>
  Array.from({ length: records.deleteEventRefs.length }, (_, index) => {
    const start = records.targetOffsets[index] ?? 0;
    const end = records.targetOffsets[index + 1] ?? start;
    return {
      deleteEventId: readIdRef(
        records.idTable,
        records.deleteEventRefs[index] ?? 0,
      ),
      targetIds: Array.from(records.targetRefs.subarray(start, end), (ref) =>
        readIdRef(records.idTable, ref),
      ),
    };
  });

export function* iterateCompactDeleteTargets(
  records: CompactDeleteTargetRecords,
): IterableIterator<DeleteTargetRecord> {
  for (let index = 0; index < records.deleteEventRefs.length; index++) {
    const start = records.targetOffsets[index] ?? 0;
    const end = records.targetOffsets[index + 1] ?? start;
    yield {
      deleteEventId: readIdRef(
        records.idTable,
        records.deleteEventRefs[index] ?? 0,
      ),
      targetIds: Array.from(records.targetRefs.subarray(start, end), (ref) =>
        readIdRef(records.idTable, ref),
      ),
    };
  }
}

const readIdRef = (
  table: ReadonlyArray<EventId>,
  zeroBasedRef: number,
): EventId => {
  const value = table[zeroBasedRef];
  if (value === undefined) {
    throw new Error(`Invalid compact delete target id ref ${zeroBasedRef}`);
  }
  return value;
};

/**
 * Bidirectional index of delete events and the CRDT records they targeted.
 *
 * `targets` maps a delete event id to its list of targeted item ids;
 * retreat / advance walks this list to toggle each item's
 * `prepareState`. `byItem` is the reverse view, maintained so that
 * `RecordSplitter.splitRecordAt` can extend the membership to the new
 * right half when it carves a previously-deleted record in two:
 * without this, retreating / advancing the delete only flips the
 * prepare-state of the left half and the right half stays
 * prepare-visible even though it is effect-deleted, which shifts
 * later prepare-index lookups (e.g. local inserts anchored at the
 * document end) into the middle of the deleted range.
 */
export class DeleteTargetIndex {
  private readonly targets = new Map<EventId, StoredDeleteTargets>();
  private readonly byItem = new Map<EventId, DeleteOwners>();

  clear(): void {
    this.targets.clear();
    this.byItem.clear();
  }

  entries(): DeleteTargetRecord[] {
    return Array.from(this.targets, ([deleteEventId, targetIds]) => ({
      deleteEventId,
      targetIds: typeof targetIds === "string" ? [targetIds] : [...targetIds],
    }));
  }

  targetsOf(deleteEventId: EventId): ReadonlyArray<EventId> | undefined {
    const targets = this.targets.get(deleteEventId);
    if (targets === undefined) {
      return undefined;
    }
    return typeof targets === "string" ? [targets] : targets;
  }

  /**
   * Return the compact target representation used by the replay hot path.
   * Atomic deletes yield their item id directly instead of allocating a
   * one-element wrapper on every retreat / advance transition.
   */
  targetRefsOf(deleteEventId: EventId): DeleteTargetRefs | undefined {
    return this.targets.get(deleteEventId);
  }

  record(deleteEventId: EventId, itemIds: ReadonlyArray<EventId>): void {
    const first = itemIds[0];
    this.targets.set(
      deleteEventId,
      itemIds.length === 1 && first !== undefined ? first : [...itemIds],
    );
    for (const itemId of itemIds) {
      const owners = this.byItem.get(itemId);
      if (owners === undefined) {
        this.byItem.set(itemId, deleteEventId);
      } else if (typeof owners === "string") {
        if (owners !== deleteEventId) {
          this.byItem.set(itemId, new Set([owners, deleteEventId]));
        }
      } else {
        owners.add(deleteEventId);
      }
    }
  }

  extendMembership(fromItemId: EventId, toItemId: EventId): void {
    const owners = this.byItem.get(fromItemId);
    if (owners === undefined) {
      return;
    }

    if (typeof owners === "string") {
      this.extendOwnerMembership(owners, toItemId);
      return;
    }
    for (const deleteEventId of owners) {
      this.extendOwnerMembership(deleteEventId, toItemId);
    }
  }

  private extendOwnerMembership(
    deleteEventId: EventId,
    toItemId: EventId,
  ): void {
    const mirrored = this.byItem.get(toItemId);
    if (
      mirrored === deleteEventId ||
      (mirrored instanceof Set && mirrored.has(deleteEventId))
    ) {
      return;
    }

    const targets = this.targets.get(deleteEventId);
    if (targets === undefined) {
      return;
    }
    if (typeof targets === "string") {
      this.targets.set(deleteEventId, [targets, toItemId]);
    } else {
      targets.push(toItemId);
    }

    if (mirrored === undefined) {
      this.byItem.set(toItemId, deleteEventId);
    } else if (typeof mirrored === "string") {
      this.byItem.set(toItemId, new Set([mirrored, deleteEventId]));
    } else {
      mirrored.add(deleteEventId);
    }
  }
}
