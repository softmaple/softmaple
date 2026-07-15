import type { EventId } from "../../types";
import type { AugmentedCRDTItem } from "./engine-types";
import type { SegmentedPlaceholderState } from "./segmented-placeholder";

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

export interface PlaceholderDeleteTarget {
  readonly kind: "placeholder-range";
  readonly state: SegmentedPlaceholderState<AugmentedCRDTItem>;
  readonly start: number;
  readonly end: number;
}

export type RuntimeDeleteTarget = EventId | PlaceholderDeleteTarget;
export type DeleteTargetRefs =
  | RuntimeDeleteTarget
  | ReadonlyArray<RuntimeDeleteTarget>;

type StoredDeleteTargets = RuntimeDeleteTarget | RuntimeDeleteTarget[];
type DeleteOwners = EventId | Set<EventId>;

export const isPlaceholderDeleteTarget = (
  target: DeleteTargetRefs,
): target is PlaceholderDeleteTarget =>
  typeof target !== "string" && !Array.isArray(target);

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

  entries(
    materializePlaceholder?: (
      target: PlaceholderDeleteTarget,
    ) => ReadonlyArray<EventId>,
  ): DeleteTargetRecord[] {
    return Array.from(this.targets, ([deleteEventId, targets]) => ({
      deleteEventId,
      targetIds: this.materializeTargets(targets, materializePlaceholder),
    }));
  }

  targetsOf(deleteEventId: EventId): ReadonlyArray<EventId> | undefined {
    const targets = this.targets.get(deleteEventId);
    if (targets === undefined) {
      return undefined;
    }
    return this.materializeTargets(targets);
  }

  /**
   * Return the compact target representation used by the replay hot path.
   * Atomic deletes yield their item id directly instead of allocating a
   * one-element wrapper on every retreat / advance transition.
   */
  targetRefsOf(deleteEventId: EventId): DeleteTargetRefs | undefined {
    return this.targets.get(deleteEventId);
  }

  /** Store the dominant one-delete/one-record case without an array. */
  recordOne(deleteEventId: EventId, itemId: EventId): void {
    this.recordRuntimeOne(deleteEventId, itemId);
  }

  record(deleteEventId: EventId, itemIds: ReadonlyArray<EventId>): void {
    this.recordRuntime(deleteEventId, itemIds);
  }

  recordRuntimeOne(deleteEventId: EventId, target: RuntimeDeleteTarget): void {
    this.targets.set(deleteEventId, target);
    if (typeof target === "string") {
      this.addOwner(target, deleteEventId);
    }
  }

  recordRuntime(
    deleteEventId: EventId,
    targets: ReadonlyArray<RuntimeDeleteTarget>,
  ): void {
    const first = targets[0];
    this.targets.set(
      deleteEventId,
      targets.length === 1 && first !== undefined ? first : [...targets],
    );
    for (const target of targets) {
      if (typeof target === "string") {
        this.addOwner(target, deleteEventId);
      }
    }
  }

  private materializeTargets(
    targets: StoredDeleteTargets,
    materializePlaceholder?: (
      target: PlaceholderDeleteTarget,
    ) => ReadonlyArray<EventId>,
  ): EventId[] {
    const materialized: EventId[] = [];
    const append = (target: RuntimeDeleteTarget): void => {
      if (typeof target === "string") {
        materialized.push(target);
        return;
      }
      if (materializePlaceholder === undefined) {
        throw new Error("Segmented placeholder targets require a materializer");
      }
      materialized.push(...materializePlaceholder(target));
    };
    if (Array.isArray(targets)) {
      for (const target of targets) {
        append(target);
      }
    } else {
      append(targets);
    }
    return materialized;
  }

  private addOwner(itemId: EventId, deleteEventId: EventId): void {
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
    } else if (!Array.isArray(targets)) {
      throw new Error(
        `Delete target ${deleteEventId} has no item membership for ${toItemId}`,
      );
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
