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
      targetIds: Array.from(records.targetRefs.slice(start, end), (ref) =>
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
  private readonly targets = new Map<EventId, EventId[]>();
  private readonly byItem = new Map<EventId, Set<EventId>>();

  clear(): void {
    this.targets.clear();
    this.byItem.clear();
  }

  entries(): DeleteTargetRecord[] {
    return Array.from(this.targets, ([deleteEventId, targetIds]) => ({
      deleteEventId,
      targetIds: [...targetIds],
    }));
  }

  targetsOf(deleteEventId: EventId): ReadonlyArray<EventId> | undefined {
    return this.targets.get(deleteEventId);
  }

  record(deleteEventId: EventId, itemIds: ReadonlyArray<EventId>): void {
    this.targets.set(deleteEventId, [...itemIds]);
    for (const itemId of itemIds) {
      let owners = this.byItem.get(itemId);
      if (!owners) {
        owners = new Set<EventId>();
        this.byItem.set(itemId, owners);
      }
      owners.add(deleteEventId);
    }
  }

  extendMembership(fromItemId: EventId, toItemId: EventId): void {
    const owners = this.byItem.get(fromItemId);
    if (!owners || owners.size === 0) {
      return;
    }
    let mirrored = this.byItem.get(toItemId);
    for (const deleteEventId of owners) {
      // Invariant: `toItemId` is a freshly minted `nextPlaceholderId()`,
      // so it cannot already appear in this delete event's target list.
      // Guard defensively so a future call site that breaks the freshness
      // assumption doesn't silently produce duplicate entries (which would
      // double-toggle prepare-state on retreat/advance).
      if (mirrored?.has(deleteEventId)) {
        continue;
      }
      const targets = this.targets.get(deleteEventId);
      if (!targets) {
        continue;
      }
      targets.push(toItemId);
      if (!mirrored) {
        mirrored = new Set<EventId>();
        this.byItem.set(toItemId, mirrored);
      }
      mirrored.add(deleteEventId);
    }
  }
}
