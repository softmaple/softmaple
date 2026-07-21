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

export interface TypedRunDeleteTarget {
  readonly kind: "typed-run-event";
  readonly eventId: EventId;
}

export type RuntimeDeleteTarget =
  | EventId
  | PlaceholderDeleteTarget
  | TypedRunDeleteTarget;
export type DeleteTargetRefs =
  | RuntimeDeleteTarget
  | ReadonlyArray<RuntimeDeleteTarget>;

export const DELETE_TARGET_KIND = {
  ITEM: 1,
  PLACEHOLDER: 2,
  RUN_EVENT: 3,
} as const;

export type DeleteTargetKind =
  (typeof DELETE_TARGET_KIND)[keyof typeof DELETE_TARGET_KIND];
export type DeleteTargetGroupHandle = number;
export type DeleteTargetHandle = number;

type DeleteOwners = DeleteTargetGroupHandle | Set<DeleteTargetGroupHandle>;

const EMPTY_HANDLE = 0;
const EMPTY_PACKED_ORDER_GROUPS = new Uint32Array(0);
const INITIAL_CAPACITY = 16;
const MAX_UINT32 = 0xffff_ffff;

export const isPlaceholderDeleteTarget = (
  target: DeleteTargetRefs,
): target is PlaceholderDeleteTarget =>
  typeof target !== "string" &&
  !Array.isArray(target) &&
  "kind" in target &&
  target.kind === "placeholder-range";

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
 * `byItem` records group handles only for ordinary item targets. Segmented
 * placeholder ranges and typed-run event coordinates remain stable while
 * their physical records split. Snapshot materialization resolves both lazy
 * forms to item IDs, rebuilds ordinary reverse membership, and keeps the wire
 * and recovery formats unchanged.
 */
export class DeleteTargetIndex {
  private readonly groups = new Map<EventId, DeleteTargetGroupHandle>();
  private readonly byItem = new Map<EventId, DeleteOwners>();
  private packedOrderGroups = EMPTY_PACKED_ORDER_GROUPS;
  private packedOrderStart = 0;
  private packedGroupCount = 0;

  private groupCount = 0;
  private groupCapacity = INITIAL_CAPACITY;
  private groupHeads = new Uint32Array(INITIAL_CAPACITY + 1);
  private groupTails = new Uint32Array(INITIAL_CAPACITY + 1);
  private groupCommitted = new Uint8Array(INITIAL_CAPACITY + 1);

  private targetCount = 0;
  private targetFreeHead = EMPTY_HANDLE;
  private runEventTargetCount = 0;
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
    this.packedOrderGroups = EMPTY_PACKED_ORDER_GROUPS;
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
    this.packedOrderStart = 0;
    this.packedGroupCount = 0;
    this.targetCount = 0;
    this.targetFreeHead = EMPTY_HANDLE;
    this.runEventTargetCount = 0;
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

  /** Configure the dense delete-key lane for one packed replay order range. */
  configurePackedOrderRange(
    startOrderIndex: number,
    endOrderIndex: number,
  ): void {
    if (
      !Number.isSafeInteger(startOrderIndex) ||
      !Number.isSafeInteger(endOrderIndex) ||
      startOrderIndex < 0 ||
      endOrderIndex < startOrderIndex ||
      endOrderIndex - startOrderIndex >= MAX_UINT32
    ) {
      throw new Error(
        `Invalid packed delete order range ${startOrderIndex}..${endOrderIndex}`,
      );
    }
    if (this.packedGroupCount !== 0) {
      throw new Error("Packed delete offsets are already active");
    }
    const length = endOrderIndex - startOrderIndex;
    this.packedOrderGroups = new Uint32Array(length);
    this.packedOrderStart = startOrderIndex;
  }

  appendItem(group: DeleteTargetGroupHandle, itemId: EventId): void {
    this.assertActiveGroup(group);
    const target = this.allocateTarget(DELETE_TARGET_KIND.ITEM);
    this.targetItemIds[target] = itemId;
    this.appendTarget(group, target);
  }

  appendRunEvent(group: DeleteTargetGroupHandle, eventId: EventId): void {
    this.assertActiveGroup(group);
    const target = this.allocateTarget(DELETE_TARGET_KIND.RUN_EVENT);
    this.targetItemIds[target] = eventId;
    this.appendTarget(group, target);
    this.runEventTargetCount++;
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
      this.runEventTargetCount -= this.countRunEventTargetsInGroup(replaced);
    }
    this.groups.set(deleteEventId, group);
    this.groupCommitted[group] = 1;
    this.activeGroup = EMPTY_HANDLE;
    this.addGroupMembership(group);
  }

  commitPackedRecord(
    deleteOrderIndex: number,
    group: DeleteTargetGroupHandle,
  ): void {
    this.assertActiveGroup(group);
    const localIndex = this.assertPackedOrderAvailable(deleteOrderIndex);
    this.packedGroupCount++;
    this.packedOrderGroups[localIndex] = group;
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

  /** First target node for a packed delete replay order index. */
  firstTargetOfPackedOrder(orderIndex: number): DeleteTargetHandle {
    const group = this.packedGroupAtOrder(orderIndex);
    return group === EMPTY_HANDLE
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
      kind !== DELETE_TARGET_KIND.PLACEHOLDER &&
      kind !== DELETE_TARGET_KIND.RUN_EVENT
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

  runEventIdOf(target: DeleteTargetHandle): EventId {
    if (this.kindOf(target) !== DELETE_TARGET_KIND.RUN_EVENT) {
      throw new Error(
        `Delete target ${target} is not a typed-run event target`,
      );
    }
    const eventId = this.targetItemIds[target];
    if (eventId === undefined) {
      throw new Error(`Delete typed-run target ${target} has no event id`);
    }
    return eventId;
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

  /** Store one lazy scalar coordinate inside a typed insert run. */
  recordRunEvent(deleteEventId: EventId, targetEventId: EventId): void {
    const group = this.beginRecord();
    try {
      this.appendRunEvent(group, targetEventId);
      this.commitRecord(deleteEventId, group);
    } catch (error) {
      if (this.activeGroup === group) {
        this.abortRecord(group);
      }
      throw error;
    }
  }

  /** Store a typed-run target without materializing the packed delete ID. */
  recordPackedRunEvent(deleteOrderIndex: number, targetEventId: EventId): void {
    const group = this.beginRecord();
    try {
      this.appendRunEvent(group, targetEventId);
      this.commitPackedRecord(deleteOrderIndex, group);
    } catch (error) {
      if (this.activeGroup === group) {
        this.abortRecord(group);
      }
      throw error;
    }
  }

  /** Store one placeholder range without allocating a runtime target object. */
  recordPlaceholderRange(
    deleteEventId: EventId,
    state: SegmentedPlaceholderState<AugmentedCRDTItem>,
    start: number,
    end: number,
  ): void {
    const group = this.beginRecord();
    try {
      this.appendPlaceholderRange(group, state, start, end);
      this.commitRecord(deleteEventId, group);
    } catch (error) {
      if (this.activeGroup === group) {
        this.abortRecord(group);
      }
      throw error;
    }
  }

  /** Store a placeholder target without materializing the packed delete ID. */
  recordPackedPlaceholderRange(
    deleteOrderIndex: number,
    state: SegmentedPlaceholderState<AugmentedCRDTItem>,
    start: number,
    end: number,
  ): void {
    const group = this.beginRecord();
    try {
      this.appendPlaceholderRange(group, state, start, end);
      this.commitPackedRecord(deleteOrderIndex, group);
    } catch (error) {
      if (this.activeGroup === group) {
        this.abortRecord(group);
      }
      throw error;
    }
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

  /**
   * Resolve lazy typed-run coordinates before exposing item-ID persistence.
   * The resolver may split a run, so callers invoke this before collecting
   * sequence records as well as before collecting delete-target records.
   */
  materializeRunEventTargets(
    resolveItemId: (eventId: EventId) => EventId,
  ): void {
    for (const group of this.groups.values()) {
      this.materializeRunEventTargetsInGroup(group, resolveItemId);
    }
    for (const group of this.packedOrderGroups) {
      if (group !== EMPTY_HANDLE) {
        this.materializeRunEventTargetsInGroup(group, resolveItemId);
      }
    }
  }

  hasRunEventTargets(): boolean {
    return this.runEventTargetCount > 0;
  }

  /**
   * Split placeholder logical segments only at native-recovery boundaries.
   * Runtime replay keeps these targets as stable numeric ranges, so eagerly
   * splitting every scalar unit would add O(k log n) work to cold load while
   * providing no benefit until sequence records are serialized.
   */
  materializePlaceholderTargetBoundaries(): void {
    for (const group of this.groups.values()) {
      this.materializePlaceholderTargetBoundariesInGroup(group);
    }
    for (const group of this.packedOrderGroups) {
      if (group !== EMPTY_HANDLE) {
        this.materializePlaceholderTargetBoundariesInGroup(group);
      }
    }
  }

  materializePackedRecords(
    resolveDeleteEventId: (orderIndex: number) => EventId,
  ): void {
    if (this.packedGroupCount === 0) {
      this.releasePackedOrderRange();
      return;
    }
    for (
      let localIndex = 0;
      localIndex < this.packedOrderGroups.length;
      localIndex++
    ) {
      const group = this.packedOrderGroups[localIndex] ?? EMPTY_HANDLE;
      if (group === EMPTY_HANDLE) {
        continue;
      }
      const orderIndex = this.packedOrderStart + localIndex;
      this.materializePackedRecord(
        orderIndex,
        resolveDeleteEventId(orderIndex),
      );
    }
    this.releasePackedOrderRange();
  }

  materializePackedRecord(orderIndex: number, deleteEventId: EventId): void {
    const localIndex = this.packedLocalIndex(orderIndex);
    const group = this.packedOrderGroups[localIndex] ?? EMPTY_HANDLE;
    if (group === EMPTY_HANDLE) {
      return;
    }
    const replaced = this.groups.get(deleteEventId);
    if (replaced !== undefined && replaced !== group) {
      throw new Error(`Duplicate materialized delete event ${deleteEventId}`);
    }
    this.groups.set(deleteEventId, group);
    this.packedOrderGroups[localIndex] = EMPTY_HANDLE;
    this.packedGroupCount--;
  }

  hasPackedRecords(): boolean {
    return this.packedGroupCount > 0;
  }

  hasPackedOrderRange(): boolean {
    return this.packedOrderGroups.length > 0;
  }

  /** Reject an invalid or duplicate packed key before replay mutates state. */
  assertPackedOrderAvailable(orderIndex: number): number {
    const localIndex = this.packedLocalIndex(orderIndex);
    if ((this.packedOrderGroups[localIndex] ?? EMPTY_HANDLE) !== EMPTY_HANDLE) {
      throw new Error(`Duplicate packed delete order index ${orderIndex}`);
    }
    return localIndex;
  }

  assertPackedOrderRangeAvailable(
    startOrderIndex: number,
    endOrderIndex: number,
  ): void {
    if (
      !Number.isSafeInteger(endOrderIndex) ||
      endOrderIndex < startOrderIndex
    ) {
      throw new Error(
        `Invalid packed delete order range ${startOrderIndex}..${endOrderIndex}`,
      );
    }
    if (startOrderIndex === endOrderIndex) {
      return;
    }
    const start = this.packedLocalIndex(startOrderIndex);
    const end = this.packedLocalIndex(endOrderIndex - 1) + 1;
    for (let localIndex = start; localIndex < end; localIndex++) {
      if (
        (this.packedOrderGroups[localIndex] ?? EMPTY_HANDLE) !== EMPTY_HANDLE
      ) {
        throw new Error(
          `Duplicate packed delete order index ${this.packedOrderStart + localIndex}`,
        );
      }
    }
  }

  releasePackedOrderRange(): void {
    if (this.packedGroupCount !== 0) {
      throw new Error(
        "Cannot release packed delete keys before materialization",
      );
    }
    this.packedOrderGroups = EMPTY_PACKED_ORDER_GROUPS;
    this.packedOrderStart = 0;
  }

  materializeRunEventTargetsOfPackedOrder(
    orderIndex: number,
    resolveItemId: (eventId: EventId) => EventId,
  ): void {
    const group = this.packedGroupAtOrder(orderIndex);
    if (group !== EMPTY_HANDLE) {
      this.materializeRunEventTargetsInGroup(group, resolveItemId);
    }
  }

  private materializePlaceholderTargetBoundariesInGroup(
    group: DeleteTargetGroupHandle,
  ): void {
    let target = this.groupHeads[group] ?? EMPTY_HANDLE;
    while (target !== EMPTY_HANDLE) {
      if (this.kindOf(target) === DELETE_TARGET_KIND.PLACEHOLDER) {
        this.placeholderStateOf(target).materializeLogicalRangeBoundaries(
          this.placeholderStartOf(target),
          this.placeholderEndOf(target),
        );
      }
      target = this.targetNext[target] ?? EMPTY_HANDLE;
    }
  }

  materializeRunEventTargetsOf(
    deleteEventId: EventId,
    resolveItemId: (eventId: EventId) => EventId,
  ): void {
    const group = this.groups.get(deleteEventId);
    if (group !== undefined) {
      this.materializeRunEventTargetsInGroup(group, resolveItemId);
    }
  }

  private appendRuntimeTarget(
    group: DeleteTargetGroupHandle,
    target: RuntimeDeleteTarget,
  ): void {
    if (typeof target === "string") {
      this.appendItem(group, target);
    } else if (target.kind === "typed-run-event") {
      this.appendRunEvent(group, target.eventId);
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
    return target;
  }

  private releaseTarget(target: DeleteTargetHandle): void {
    if (this.targetKinds[target] === DELETE_TARGET_KIND.RUN_EVENT) {
      this.runEventTargetCount--;
    }
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
    const kind = this.kindOf(target);
    if (kind === DELETE_TARGET_KIND.ITEM) {
      return this.itemIdOf(target);
    }
    if (kind === DELETE_TARGET_KIND.RUN_EVENT) {
      return {
        kind: "typed-run-event",
        eventId: this.runEventIdOf(target),
      };
    }
    return {
      kind: "placeholder-range",
      state: this.placeholderStateOf(target),
      start: this.placeholderStartOf(target),
      end: this.placeholderEndOf(target),
    };
  }

  private materializeRunEventTargetsInGroup(
    group: DeleteTargetGroupHandle,
    resolveItemId: (eventId: EventId) => EventId,
  ): void {
    let target = this.groupHeads[group] ?? EMPTY_HANDLE;
    while (target !== EMPTY_HANDLE) {
      if (this.kindOf(target) === DELETE_TARGET_KIND.RUN_EVENT) {
        const itemId = resolveItemId(this.runEventIdOf(target));
        this.targetKinds[target] = DELETE_TARGET_KIND.ITEM;
        this.targetItemIds[target] = itemId;
        this.addOwner(itemId, group);
        this.runEventTargetCount--;
      }
      target = this.targetNext[target] ?? EMPTY_HANDLE;
    }
  }

  private countRunEventTargetsInGroup(group: DeleteTargetGroupHandle): number {
    let count = 0;
    let target = this.groupHeads[group] ?? EMPTY_HANDLE;
    while (target !== EMPTY_HANDLE) {
      if (this.targetKinds[target] === DELETE_TARGET_KIND.RUN_EVENT) {
        count++;
      }
      target = this.targetNext[target] ?? EMPTY_HANDLE;
    }
    return count;
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
      const kind = this.kindOf(target);
      if (kind === DELETE_TARGET_KIND.ITEM) {
        materialized.push(this.itemIdOf(target));
      } else if (kind === DELETE_TARGET_KIND.PLACEHOLDER) {
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
      } else {
        throw new Error(
          "Typed-run event targets must be materialized before reading item IDs",
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

  private packedGroupAtOrder(orderIndex: number): DeleteTargetGroupHandle {
    const localIndex = this.packedLocalIndex(orderIndex);
    return this.packedOrderGroups[localIndex] ?? EMPTY_HANDLE;
  }

  private packedLocalIndex(orderIndex: number): number {
    const localIndex = orderIndex - this.packedOrderStart;
    if (
      !Number.isSafeInteger(orderIndex) ||
      localIndex < 0 ||
      localIndex >= this.packedOrderGroups.length
    ) {
      throw new Error(`Invalid packed delete order index ${orderIndex}`);
    }
    return localIndex;
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
