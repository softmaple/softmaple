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

export const DELETE_TARGET_KIND = {
  ITEM: 1,
  PLACEHOLDER: 2,
} as const;

export type DeleteTargetKind =
  (typeof DELETE_TARGET_KIND)[keyof typeof DELETE_TARGET_KIND];
export type DeleteTargetGroupHandle = number;
export type DeleteTargetHandle = number;

type DeleteOwners = DeleteTargetGroupHandle | Set<DeleteTargetGroupHandle>;

const EMPTY_HANDLE = 0;
const INITIAL_CAPACITY = 16;
const MAX_UINT32 = 0xffff_ffff;

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
 * Runtime targets live in numeric arenas rather than one object/array per
 * delete. The compatibility accessors materialize their historical unions at
 * API boundaries, while replay can walk the numeric cursor without allocating.
 * Placeholder offsets use Float64 columns so the arena preserves the engine's
 * safe-integer document range instead of silently truncating at 2^32.
 *
 * `byItem` records group handles only for ordinary item targets. A segmented
 * placeholder target is a stable logical coordinate range, so splitting its
 * physical ranked-sequence record does not change target membership. Once a
 * snapshot materializes such a range to item IDs, normal reverse membership
 * is rebuilt by {@link record} and future record splits extend both halves.
 */
export class DeleteTargetIndex {
  private readonly groups = new Map<EventId, DeleteTargetGroupHandle>();
  private readonly byItem = new Map<EventId, DeleteOwners>();

  private groupCount = 0;
  private groupCapacity = INITIAL_CAPACITY;
  private groupHeads = new Uint32Array(INITIAL_CAPACITY + 1);
  private groupTails = new Uint32Array(INITIAL_CAPACITY + 1);
  private groupCommitted = new Uint8Array(INITIAL_CAPACITY + 1);

  private targetCount = 0;
  private targetFreeHead = EMPTY_HANDLE;
  private targetCapacity = INITIAL_CAPACITY;
  private targetKinds = new Uint8Array(INITIAL_CAPACITY + 1);
  private targetNext = new Uint32Array(INITIAL_CAPACITY + 1);
  private targetStateRefs = new Uint32Array(INITIAL_CAPACITY + 1);
  private targetStarts = new Float64Array(INITIAL_CAPACITY + 1);
  private targetEnds = new Float64Array(INITIAL_CAPACITY + 1);
  private targetItemIds: Array<EventId | undefined> = [undefined];

  private placeholderStateRefs = new WeakMap<
    SegmentedPlaceholderState<AugmentedCRDTItem>,
    number
  >();
  private placeholderStates: Array<
    SegmentedPlaceholderState<AugmentedCRDTItem> | undefined
  > = [undefined];

  private activeGroup = EMPTY_HANDLE;

  clear(): void {
    this.groups.clear();
    this.byItem.clear();
    this.groupHeads.fill(0, 0, this.groupCount + 1);
    this.groupTails.fill(0, 0, this.groupCount + 1);
    this.groupCommitted.fill(0, 0, this.groupCount + 1);
    this.targetKinds.fill(0, 0, this.targetCount + 1);
    this.targetNext.fill(0, 0, this.targetCount + 1);
    this.targetStateRefs.fill(0, 0, this.targetCount + 1);
    this.targetStarts.fill(0, 0, this.targetCount + 1);
    this.targetEnds.fill(0, 0, this.targetCount + 1);
    this.targetItemIds.length = 1;
    this.placeholderStateRefs = new WeakMap();
    this.placeholderStates = [undefined];
    this.groupCount = 0;
    this.targetCount = 0;
    this.targetFreeHead = EMPTY_HANDLE;
    this.activeGroup = EMPTY_HANDLE;
  }

  entries(
    materializePlaceholder?: (
      target: PlaceholderDeleteTarget,
    ) => ReadonlyArray<EventId>,
  ): DeleteTargetRecord[] {
    return Array.from(this.groups, ([deleteEventId, group]) => ({
      deleteEventId,
      targetIds: this.materializeTargetIds(group, materializePlaceholder),
    }));
  }

  targetsOf(deleteEventId: EventId): ReadonlyArray<EventId> | undefined {
    const group = this.groups.get(deleteEventId);
    if (group === undefined) {
      return undefined;
    }
    return this.materializeTargetIds(group);
  }

  /**
   * Compatibility view of the historical scalar/array target union.
   * Replay should prefer {@link firstTargetOf} and the numeric cursor methods.
   */
  targetRefsOf(deleteEventId: EventId): DeleteTargetRefs | undefined {
    const group = this.groups.get(deleteEventId);
    if (group === undefined) {
      return undefined;
    }
    const first = this.groupHeads[group] ?? EMPTY_HANDLE;
    if (first === EMPTY_HANDLE) {
      return [];
    }
    const firstTarget = this.materializeRuntimeTarget(first);
    const second = this.targetNext[first] ?? EMPTY_HANDLE;
    if (second === EMPTY_HANDLE) {
      return firstTarget;
    }
    const targets: RuntimeDeleteTarget[] = [firstTarget];
    let target = second;
    while (target !== EMPTY_HANDLE) {
      targets.push(this.materializeRuntimeTarget(target));
      target = this.targetNext[target] ?? EMPTY_HANDLE;
    }
    return targets;
  }

  /** Start one allocation-free target builder. Builders are not re-entrant. */
  beginRecord(): DeleteTargetGroupHandle {
    if (this.activeGroup !== EMPTY_HANDLE) {
      throw new Error("A delete target record builder is already active");
    }
    const group = this.groupCount + 1;
    if (group >= MAX_UINT32) {
      throw new Error("Delete target group capacity exceeded");
    }
    this.ensureGroupCapacity(group);
    this.groupCount = group;
    this.groupHeads[group] = EMPTY_HANDLE;
    this.groupTails[group] = EMPTY_HANDLE;
    this.groupCommitted[group] = 0;
    this.activeGroup = group;
    return group;
  }

  appendItem(group: DeleteTargetGroupHandle, itemId: EventId): void {
    this.assertActiveGroup(group);
    const target = this.allocateTarget(DELETE_TARGET_KIND.ITEM);
    this.targetItemIds[target] = itemId;
    this.appendTarget(group, target);
  }

  appendPlaceholderRange(
    group: DeleteTargetGroupHandle,
    state: SegmentedPlaceholderState<AugmentedCRDTItem>,
    start: number,
    end: number,
  ): void {
    this.assertActiveGroup(group);
    this.assertPlaceholderRange(state, start, end);
    const target = this.allocateTarget(DELETE_TARGET_KIND.PLACEHOLDER);
    this.targetStateRefs[target] = this.internPlaceholderState(state);
    this.targetStarts[target] = start;
    this.targetEnds[target] = end;
    this.appendTarget(group, target);
  }

  commitRecord(deleteEventId: EventId, group: DeleteTargetGroupHandle): void {
    this.assertActiveGroup(group);
    const replaced = this.groups.get(deleteEventId);
    if (replaced !== undefined) {
      this.removeGroupMembership(replaced);
    }
    this.groups.set(deleteEventId, group);
    this.groupCommitted[group] = 1;
    this.activeGroup = EMPTY_HANDLE;
    this.addGroupMembership(group);
  }

  abortRecord(group: DeleteTargetGroupHandle): void {
    this.assertActiveGroup(group);
    let target = this.groupHeads[group] ?? EMPTY_HANDLE;
    while (target !== EMPTY_HANDLE) {
      const next = this.targetNext[target] ?? EMPTY_HANDLE;
      this.releaseTarget(target);
      target = next;
    }
    this.groupHeads[group] = EMPTY_HANDLE;
    this.groupTails[group] = EMPTY_HANDLE;
    this.groupCommitted[group] = 0;
    this.activeGroup = EMPTY_HANDLE;
    // An active builder is always the newest group. Reclaim its handle while
    // target nodes themselves return to a free list, which also remains safe
    // if record splits appended nodes to older committed groups meanwhile.
    this.groupCount--;
  }

  /** First target node for a delete event, or zero for missing/empty groups. */
  firstTargetOf(deleteEventId: EventId): DeleteTargetHandle {
    const group = this.groups.get(deleteEventId);
    return group === undefined
      ? EMPTY_HANDLE
      : (this.groupHeads[group] ?? EMPTY_HANDLE);
  }

  nextTarget(target: DeleteTargetHandle): DeleteTargetHandle {
    this.assertTargetHandle(target);
    return this.targetNext[target] ?? EMPTY_HANDLE;
  }

  kindOf(target: DeleteTargetHandle): DeleteTargetKind {
    this.assertTargetHandle(target);
    const kind = this.targetKinds[target];
    if (
      kind !== DELETE_TARGET_KIND.ITEM &&
      kind !== DELETE_TARGET_KIND.PLACEHOLDER
    ) {
      throw new Error(`Invalid delete target kind ${kind ?? 0}`);
    }
    return kind;
  }

  itemIdOf(target: DeleteTargetHandle): EventId {
    if (this.kindOf(target) !== DELETE_TARGET_KIND.ITEM) {
      throw new Error(`Delete target ${target} is not an item target`);
    }
    const itemId = this.targetItemIds[target];
    if (itemId === undefined) {
      throw new Error(`Delete item target ${target} has no item id`);
    }
    return itemId;
  }

  placeholderStateOf(
    target: DeleteTargetHandle,
  ): SegmentedPlaceholderState<AugmentedCRDTItem> {
    if (this.kindOf(target) !== DELETE_TARGET_KIND.PLACEHOLDER) {
      throw new Error(`Delete target ${target} is not a placeholder target`);
    }
    const stateRef = this.targetStateRefs[target] ?? 0;
    const state = this.placeholderStates[stateRef];
    if (state === undefined) {
      throw new Error(`Delete placeholder target ${target} has no state`);
    }
    return state;
  }

  placeholderStartOf(target: DeleteTargetHandle): number {
    if (this.kindOf(target) !== DELETE_TARGET_KIND.PLACEHOLDER) {
      throw new Error(`Delete target ${target} is not a placeholder target`);
    }
    return this.targetStarts[target] ?? 0;
  }

  placeholderEndOf(target: DeleteTargetHandle): number {
    if (this.kindOf(target) !== DELETE_TARGET_KIND.PLACEHOLDER) {
      throw new Error(`Delete target ${target} is not a placeholder target`);
    }
    return this.targetEnds[target] ?? 0;
  }

  /** Store the dominant one-delete/one-record case without an array. */
  recordOne(deleteEventId: EventId, itemId: EventId): void {
    this.recordRuntimeOne(deleteEventId, itemId);
  }

  record(deleteEventId: EventId, itemIds: ReadonlyArray<EventId>): void {
    const group = this.beginRecord();
    try {
      for (const itemId of itemIds) {
        this.appendItem(group, itemId);
      }
      this.commitRecord(deleteEventId, group);
    } catch (error) {
      if (this.activeGroup === group) {
        this.abortRecord(group);
      }
      throw error;
    }
  }

  recordRuntimeOne(deleteEventId: EventId, target: RuntimeDeleteTarget): void {
    const group = this.beginRecord();
    try {
      this.appendRuntimeTarget(group, target);
      this.commitRecord(deleteEventId, group);
    } catch (error) {
      if (this.activeGroup === group) {
        this.abortRecord(group);
      }
      throw error;
    }
  }

  recordRuntime(
    deleteEventId: EventId,
    targets: ReadonlyArray<RuntimeDeleteTarget>,
  ): void {
    const group = this.beginRecord();
    try {
      for (const target of targets) {
        this.appendRuntimeTarget(group, target);
      }
      this.commitRecord(deleteEventId, group);
    } catch (error) {
      if (this.activeGroup === group) {
        this.abortRecord(group);
      }
      throw error;
    }
  }

  extendMembership(fromItemId: EventId, toItemId: EventId): void {
    const owners = this.byItem.get(fromItemId);
    if (owners === undefined) {
      return;
    }

    if (typeof owners === "number") {
      this.extendGroupMembership(owners, toItemId);
      return;
    }
    for (const group of owners) {
      this.extendGroupMembership(group, toItemId);
    }
  }

  private appendRuntimeTarget(
    group: DeleteTargetGroupHandle,
    target: RuntimeDeleteTarget,
  ): void {
    if (typeof target === "string") {
      this.appendItem(group, target);
    } else {
      this.appendPlaceholderRange(
        group,
        target.state,
        target.start,
        target.end,
      );
    }
  }

  private appendTarget(
    group: DeleteTargetGroupHandle,
    target: DeleteTargetHandle,
  ): void {
    const tail = this.groupTails[group] ?? EMPTY_HANDLE;
    if (tail === EMPTY_HANDLE) {
      this.groupHeads[group] = target;
    } else {
      this.targetNext[tail] = target;
    }
    this.groupTails[group] = target;
  }

  private allocateTarget(kind: DeleteTargetKind): DeleteTargetHandle {
    let target = this.targetFreeHead;
    if (target !== EMPTY_HANDLE) {
      this.targetFreeHead = this.targetNext[target] ?? EMPTY_HANDLE;
    } else {
      target = this.targetCount + 1;
      if (target >= MAX_UINT32) {
        throw new Error("Delete target arena capacity exceeded");
      }
      this.ensureTargetCapacity(target);
      this.targetCount = target;
    }
    this.targetKinds[target] = kind;
    this.targetNext[target] = EMPTY_HANDLE;
    this.targetStateRefs[target] = 0;
    this.targetStarts[target] = 0;
    this.targetEnds[target] = 0;
    this.targetItemIds[target] = undefined;
    return target;
  }

  private releaseTarget(target: DeleteTargetHandle): void {
    this.targetKinds[target] = 0;
    this.targetStateRefs[target] = 0;
    this.targetStarts[target] = 0;
    this.targetEnds[target] = 0;
    this.targetItemIds[target] = undefined;
    this.targetNext[target] = this.targetFreeHead;
    this.targetFreeHead = target;
  }

  private internPlaceholderState(
    state: SegmentedPlaceholderState<AugmentedCRDTItem>,
  ): number {
    const existing = this.placeholderStateRefs.get(state);
    if (existing !== undefined) {
      return existing;
    }
    const stateRef = this.placeholderStates.length;
    if (stateRef >= MAX_UINT32) {
      throw new Error("Delete placeholder state capacity exceeded");
    }
    this.placeholderStates.push(state);
    this.placeholderStateRefs.set(state, stateRef);
    return stateRef;
  }

  private materializeRuntimeTarget(
    target: DeleteTargetHandle,
  ): RuntimeDeleteTarget {
    if (this.kindOf(target) === DELETE_TARGET_KIND.ITEM) {
      return this.itemIdOf(target);
    }
    return {
      kind: "placeholder-range",
      state: this.placeholderStateOf(target),
      start: this.placeholderStartOf(target),
      end: this.placeholderEndOf(target),
    };
  }

  private materializeTargetIds(
    group: DeleteTargetGroupHandle,
    materializePlaceholder?: (
      target: PlaceholderDeleteTarget,
    ) => ReadonlyArray<EventId>,
  ): EventId[] {
    const materialized: EventId[] = [];
    let target = this.groupHeads[group] ?? EMPTY_HANDLE;
    while (target !== EMPTY_HANDLE) {
      if (this.kindOf(target) === DELETE_TARGET_KIND.ITEM) {
        materialized.push(this.itemIdOf(target));
      } else {
        if (materializePlaceholder === undefined) {
          throw new Error(
            "Segmented placeholder targets require a materializer",
          );
        }
        materialized.push(
          ...materializePlaceholder({
            kind: "placeholder-range",
            state: this.placeholderStateOf(target),
            start: this.placeholderStartOf(target),
            end: this.placeholderEndOf(target),
          }),
        );
      }
      target = this.targetNext[target] ?? EMPTY_HANDLE;
    }
    return materialized;
  }

  private addGroupMembership(group: DeleteTargetGroupHandle): void {
    let target = this.groupHeads[group] ?? EMPTY_HANDLE;
    while (target !== EMPTY_HANDLE) {
      if (this.kindOf(target) === DELETE_TARGET_KIND.ITEM) {
        this.addOwner(this.itemIdOf(target), group);
      }
      target = this.targetNext[target] ?? EMPTY_HANDLE;
    }
  }

  private removeGroupMembership(group: DeleteTargetGroupHandle): void {
    let target = this.groupHeads[group] ?? EMPTY_HANDLE;
    while (target !== EMPTY_HANDLE) {
      if (this.kindOf(target) === DELETE_TARGET_KIND.ITEM) {
        this.removeOwner(this.itemIdOf(target), group);
      }
      target = this.targetNext[target] ?? EMPTY_HANDLE;
    }
  }

  private addOwner(itemId: EventId, group: DeleteTargetGroupHandle): void {
    const owners = this.byItem.get(itemId);
    if (owners === undefined) {
      this.byItem.set(itemId, group);
    } else if (typeof owners === "number") {
      if (owners !== group) {
        this.byItem.set(itemId, new Set([owners, group]));
      }
    } else {
      owners.add(group);
    }
  }

  private removeOwner(itemId: EventId, group: DeleteTargetGroupHandle): void {
    const owners = this.byItem.get(itemId);
    if (owners === undefined) {
      return;
    }
    if (typeof owners === "number") {
      if (owners === group) {
        this.byItem.delete(itemId);
      }
      return;
    }
    owners.delete(group);
    if (owners.size === 0) {
      this.byItem.delete(itemId);
    } else if (owners.size === 1) {
      const remaining = owners.values().next().value;
      if (remaining !== undefined) {
        this.byItem.set(itemId, remaining);
      }
    }
  }

  private extendGroupMembership(
    group: DeleteTargetGroupHandle,
    toItemId: EventId,
  ): void {
    if (this.groupCommitted[group] !== 1) {
      return;
    }
    const mirrored = this.byItem.get(toItemId);
    if (
      mirrored === group ||
      (mirrored instanceof Set && mirrored.has(group))
    ) {
      return;
    }

    const target = this.allocateTarget(DELETE_TARGET_KIND.ITEM);
    this.targetItemIds[target] = toItemId;
    this.appendTarget(group, target);
    this.addOwner(toItemId, group);
  }

  private assertActiveGroup(group: DeleteTargetGroupHandle): void {
    if (
      !Number.isSafeInteger(group) ||
      group <= 0 ||
      group !== this.activeGroup ||
      this.groupCommitted[group] !== 0
    ) {
      throw new Error(`Delete target group ${group} is not the active builder`);
    }
  }

  private assertTargetHandle(target: DeleteTargetHandle): void {
    if (
      !Number.isSafeInteger(target) ||
      target <= 0 ||
      target > this.targetCount ||
      this.targetKinds[target] === 0
    ) {
      throw new Error(`Invalid delete target handle ${target}`);
    }
  }

  private assertPlaceholderRange(
    state: SegmentedPlaceholderState<AugmentedCRDTItem>,
    start: number,
    end: number,
  ): void {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start ||
      end > state.length
    ) {
      throw new Error(
        `Invalid placeholder delete target [${start}, ${end}) for length ${state.length}`,
      );
    }
  }

  private ensureGroupCapacity(required: number): void {
    if (required <= this.groupCapacity) {
      return;
    }
    const capacity = growCapacity(this.groupCapacity, required);
    const length = capacity + 1;
    this.groupHeads = growUint32Array(this.groupHeads, length);
    this.groupTails = growUint32Array(this.groupTails, length);
    this.groupCommitted = growUint8Array(this.groupCommitted, length);
    this.groupCapacity = capacity;
  }

  private ensureTargetCapacity(required: number): void {
    if (required <= this.targetCapacity) {
      return;
    }
    const capacity = growCapacity(this.targetCapacity, required);
    const length = capacity + 1;
    this.targetKinds = growUint8Array(this.targetKinds, length);
    this.targetNext = growUint32Array(this.targetNext, length);
    this.targetStateRefs = growUint32Array(this.targetStateRefs, length);
    this.targetStarts = growFloat64Array(this.targetStarts, length);
    this.targetEnds = growFloat64Array(this.targetEnds, length);
    this.targetCapacity = capacity;
  }
}

const growCapacity = (current: number, required: number): number => {
  let capacity = current;
  while (capacity < required) {
    const next = capacity * 2;
    if (!Number.isSafeInteger(next) || next >= MAX_UINT32) {
      throw new Error("Delete target arena capacity exceeded");
    }
    capacity = next;
  }
  return capacity;
};

const growUint32Array = (
  source: Uint32Array<ArrayBuffer>,
  length: number,
): Uint32Array<ArrayBuffer> => {
  const grown = new Uint32Array(length);
  grown.set(source);
  return grown;
};

const growUint8Array = (
  source: Uint8Array<ArrayBuffer>,
  length: number,
): Uint8Array<ArrayBuffer> => {
  const grown = new Uint8Array(length);
  grown.set(source);
  return grown;
};

const growFloat64Array = (
  source: Float64Array<ArrayBuffer>,
  length: number,
): Float64Array<ArrayBuffer> => {
  const grown = new Float64Array(length);
  grown.set(source);
  return grown;
};
