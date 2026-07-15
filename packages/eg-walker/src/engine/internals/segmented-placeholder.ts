import type { EventId } from "../../types";

export interface PlaceholderRange {
  readonly start: number;
  readonly end: number;
}

export interface PlaceholderLogicalSegment extends PlaceholderRange {
  readonly id: EventId;
  readonly prepareState: number;
  readonly everDeleted: boolean;
}

export interface PlaceholderDeleteResult<Owner extends object> {
  readonly ranges: ReadonlyArray<PlaceholderRange>;
  readonly deletedEffectLength: number;
  readonly affectedSlices: ReadonlyArray<PlaceholderPhysicalSlice<Owner>>;
}

const PREPARE_VISIBLE_UNIT = 1;
const EFFECT_VISIBLE_UNIT = 2;

interface SegmentNode {
  readonly id: EventId;
  readonly priority: number;
  spanLength: number;
  cover: number;
  effectVisible: boolean;
  parent: SegmentNode | null;
  left: SegmentNode | null;
  right: SegmentNode | null;
  subtreeLength: number;
  minCover: number;
  minCoverLength: number;
  effectVisibleLength: number;
  lazyCoverDelta: number;
  lazyHideEffect: boolean;
}

interface SliceNode<Owner extends object> {
  readonly slice: PlaceholderPhysicalSlice<Owner>;
  left: SliceNode<Owner> | null;
  right: SliceNode<Owner> | null;
  height: number;
}

/**
 * A physical ranked-sequence record backed by a range in a segmented
 * placeholder. The owner is attached after the engine has constructed the
 * corresponding CRDT item, avoiding a constructor cycle between the two.
 */
export class PlaceholderPhysicalSlice<Owner extends object> {
  private attachedOwner: Owner | null = null;
  private sliceEnd: number;
  private cachedPrepareLength = 0;
  private cachedEffectLength = 0;

  constructor(
    readonly state: SegmentedPlaceholderState<Owner>,
    readonly start: number,
    end: number,
  ) {
    this.sliceEnd = end;
  }

  get end(): number {
    return this.sliceEnd;
  }

  get length(): number {
    return this.sliceEnd - this.start;
  }

  get owner(): Owner | null {
    return this.attachedOwner;
  }

  get prepareLength(): number {
    return this.cachedPrepareLength;
  }

  get effectLength(): number {
    return this.cachedEffectLength;
  }

  attachOwner(owner: Owner): void {
    if (this.attachedOwner !== null && this.attachedOwner !== owner) {
      throw new Error("Placeholder slice already has a different owner");
    }
    this.attachedOwner = owner;
  }

  /** Engine-internal update used when a physical record is split. */
  setEnd(end: number): void {
    if (end <= this.start) {
      throw new Error(
        `Invalid placeholder slice end ${end} for start ${this.start}`,
      );
    }
    this.sliceEnd = end;
  }

  /** Engine-internal refresh after logical prepare/effect state changes. */
  setCachedLengths(prepareLength: number, effectLength: number): void {
    this.cachedPrepareLength = prepareLength;
    this.cachedEffectLength = effectLength;
  }

  /** Apply known deltas without re-querying the logical range tree. */
  adjustCachedLengths(prepareDelta: number, effectDelta: number): void {
    const prepareLength = this.cachedPrepareLength + prepareDelta;
    const effectLength = this.cachedEffectLength + effectDelta;
    if (
      !Number.isSafeInteger(prepareLength) ||
      !Number.isSafeInteger(effectLength) ||
      prepareLength < 0 ||
      effectLength < 0 ||
      prepareLength > this.length ||
      effectLength > this.length
    ) {
      throw new Error(
        `Invalid placeholder slice weights ${prepareLength}/${effectLength} for length ${this.length}`,
      );
    }
    this.cachedPrepareLength = prepareLength;
    this.cachedEffectLength = effectLength;
  }
}

/**
 * Range-compressed prepare/effect state for pre-checkpoint placeholder text.
 *
 * A placeholder starts with prepare state 1. Each active delete contributes
 * one unit of `cover`, so a code unit is prepare-visible iff its cover is zero.
 * Valid replay never produces negative coverage. The implicit treap therefore
 * needs only a subtree minimum and the length attaining that minimum: when the
 * minimum is zero, that length is the prepare-visible width; otherwise the
 * subtree is entirely hidden. This supports lazy range retreat/advance without
 * a histogram of every possible overlapping-delete count.
 *
 * Effect visibility is monotonic. The first delete lazily hides a range from
 * the effect view and no retreat makes it effect-visible again.
 */
export class SegmentedPlaceholderState<Owner extends object> {
  private root: SegmentNode;
  private sliceRoot: SliceNode<Owner> | null = null;
  private readonly allocatedSegmentIds = new Set<EventId>();
  private readonly boundaryNodes = new Map<number, SegmentNode>();
  private readonly directPathNodes: SegmentNode[] = [];
  private mutationPrepareLengthBefore = 0;
  private mutationEffectLengthBefore = 0;
  private structuralOperationCount = 0;

  constructor(
    readonly length: number,
    initialSegmentId: EventId,
    private readonly allocateSegmentId: () => EventId,
  ) {
    assertPositiveSafeInteger(length, "placeholder length");
    this.assertFreshSegmentId(initialSegmentId);
    this.root = createSegmentNode(initialSegmentId, length, 0, true);
    this.boundaryNodes.set(0, this.root);
  }

  get prepareLength(): number {
    return visiblePrepareLength(this.root);
  }

  get effectLength(): number {
    return this.root.effectVisibleLength;
  }

  get logicalSegmentCount(): number {
    return this.boundaryNodes.size;
  }

  get physicalSliceCount(): number {
    return countSliceNodes(this.sliceRoot);
  }

  getStructuralOperationCount(): number {
    return this.structuralOperationCount;
  }

  restoreStructuralOperationCount(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Invalid structural operation count ${count}`);
    }
    this.structuralOperationCount = count;
  }

  createInitialPhysicalSlice(): PlaceholderPhysicalSlice<Owner> {
    if (this.sliceRoot !== null) {
      throw new Error("Initial placeholder slice already exists");
    }
    const slice = new PlaceholderPhysicalSlice<Owner>(this, 0, this.length);
    this.refreshSlice(slice);
    this.sliceRoot = createSliceNode(slice);
    return slice;
  }

  /**
   * Register a pre-existing physical range, primarily for runtime-state
   * restore. Registered ranges may be adjacent but must not overlap.
   */
  registerPhysicalSlice(
    start: number,
    end: number,
  ): PlaceholderPhysicalSlice<Owner> {
    this.assertRange(start, end);
    const slice = new PlaceholderPhysicalSlice<Owner>(this, start, end);
    this.refreshSlice(slice);
    this.sliceRoot = this.insertSliceNode(this.sliceRoot, slice);
    return slice;
  }

  /**
   * Split only the physical ranked-sequence record. Logical state remains in
   * this shared treap; an existing logical boundary is reused, or a stable new
   * segment ID is allocated when the cut falls inside a logical run.
   */
  splitPhysicalSlice(
    slice: PlaceholderPhysicalSlice<Owner>,
    localOffset: number,
  ): PlaceholderPhysicalSlice<Owner> {
    this.assertOwnedSlice(slice);
    if (
      !Number.isSafeInteger(localOffset) ||
      localOffset <= 0 ||
      localOffset >= slice.length
    ) {
      throw new Error(
        `Invalid physical placeholder split ${localOffset} for length ${slice.length}`,
      );
    }

    const absoluteOffset = slice.start + localOffset;
    this.ensureLogicalBoundary(absoluteOffset);
    const oldEnd = slice.end;
    slice.setEnd(absoluteOffset);
    this.refreshSlice(slice);

    const right = new PlaceholderPhysicalSlice<Owner>(
      this,
      absoluteOffset,
      oldEnd,
    );
    this.refreshSlice(right);
    this.sliceRoot = this.insertSliceNode(this.sliceRoot, right);
    return right;
  }

  segmentIdAtBoundary(offset: number): EventId {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= this.length) {
      throw new Error(`Invalid logical placeholder boundary ${offset}`);
    }
    this.ensureLogicalBoundary(offset);
    const node = this.boundaryNodes.get(offset);
    if (node === undefined) {
      throw new Error(`Missing logical placeholder boundary ${offset}`);
    }
    return node.id;
  }

  prepareLengthInRange(start: number, end: number): number {
    this.assertRangeAllowEmpty(start, end);
    return this.preparePrefix(end) - this.preparePrefix(start);
  }

  effectLengthInRange(start: number, end: number): number {
    this.assertRangeAllowEmpty(start, end);
    return this.effectPrefix(end) - this.effectPrefix(start);
  }

  /** Map a prepare-visible rank in a physical slice to a UTF-16 content offset. */
  contentOffsetAtPrepareRank(
    slice: PlaceholderPhysicalSlice<Owner>,
    rank: number,
  ): number {
    this.assertOwnedSlice(slice);
    if (
      !Number.isSafeInteger(rank) ||
      rank < 0 ||
      rank >= slice.prepareLength
    ) {
      throw new Error(
        `Invalid prepare rank ${rank} for placeholder slice width ${slice.prepareLength}`,
      );
    }
    const absoluteRank = this.preparePrefix(slice.start) + rank;
    const absoluteOffset = this.selectPrepareOffset(absoluteRank);
    if (absoluteOffset >= slice.end) {
      throw new Error("Prepare rank escaped its physical placeholder slice");
    }
    return absoluteOffset - slice.start;
  }

  /**
   * Map an insertion boundary to the position immediately after the previous
   * prepare-visible code unit. This intentionally differs from mapping the
   * next visible unit when a deleted gap follows the cursor.
   */
  contentBoundaryAtPrepareRank(
    slice: PlaceholderPhysicalSlice<Owner>,
    rank: number,
  ): number {
    this.assertOwnedSlice(slice);
    if (!Number.isSafeInteger(rank) || rank < 0 || rank > slice.prepareLength) {
      throw new Error(
        `Invalid prepare boundary rank ${rank} for placeholder slice width ${slice.prepareLength}`,
      );
    }
    if (rank === 0) {
      return 0;
    }
    return this.contentOffsetAtPrepareRank(slice, rank - 1) + 1;
  }

  collectPrepareVisibleRanges(
    start: number,
    end: number,
    maxLength: number,
  ): ReadonlyArray<PlaceholderRange> {
    this.assertRangeAllowEmpty(start, end);
    if (!Number.isSafeInteger(maxLength) || maxLength < 0) {
      throw new Error(`Invalid maximum visible length ${maxLength}`);
    }
    if (start === end || maxLength === 0) {
      return [];
    }

    const ranges: PlaceholderRange[] = [];
    let remaining = maxLength;
    this.visitLogicalSegments(start, end, (segment) => {
      if (remaining === 0 || segment.prepareState !== 1) {
        return remaining > 0;
      }
      const length = Math.min(segment.end - segment.start, remaining);
      appendRange(ranges, segment.start, segment.start + length);
      remaining -= length;
      return remaining > 0;
    });
    return ranges;
  }

  collectEffectVisibleRanges(
    start: number,
    end: number,
  ): ReadonlyArray<PlaceholderRange> {
    this.assertRangeAllowEmpty(start, end);
    const ranges: PlaceholderRange[] = [];
    this.visitLogicalSegments(start, end, (segment) => {
      if (!segment.everDeleted) {
        appendRange(ranges, segment.start, segment.end);
      }
      return true;
    });
    return ranges;
  }

  /** Apply one delete to exactly the currently prepare-visible code units. */
  deletePrepareVisible(
    start: number,
    end: number,
    maxLength: number,
  ): PlaceholderDeleteResult<Owner> {
    const ranges = this.collectPrepareVisibleRanges(start, end, maxLength);
    let deletedEffectLength = 0;
    for (const range of ranges) {
      deletedEffectLength += this.effectLengthInRange(range.start, range.end);
    }

    for (const range of ranges) {
      this.mutateRange(range.start, range.end, 1, true);
    }
    const affectedSlices = this.refreshSlicesForRanges(ranges);
    return { ranges, deletedEffectLength, affectedSlices };
  }

  /**
   * Delete exactly one prepare-visible UTF-16 code unit in a physical slice.
   *
   * This scalar replay path performs no per-call range/result allocation. It
   * validates visibility before creating logical boundaries, mutates the
   * aligned segment through the reusable parent path, and applies the known
   * one-unit cache deltas directly to the owning physical slice.
   *
   * @returns `1` when the unit was effect-visible before deletion, otherwise
   * `0` when a previous delete had already hidden it from the effect view.
   */
  deletePrepareVisibleUnitInSlice(
    slice: PlaceholderPhysicalSlice<Owner>,
    localOffset: number,
  ): number {
    const operationCountBeforeValidation = this.structuralOperationCount;
    let visibility = 0;
    try {
      this.assertOwnedSlice(slice);
      if (
        !Number.isSafeInteger(localOffset) ||
        localOffset < 0 ||
        localOffset >= slice.length
      ) {
        throw new Error(
          `Invalid placeholder delete offset ${localOffset} for slice length ${slice.length}`,
        );
      }
      visibility = this.unitVisibilityAtContentOffset(
        slice.start + localOffset,
      );
      if ((visibility & PREPARE_VISIBLE_UNIT) === 0) {
        throw new Error(
          `Placeholder unit ${slice.start + localOffset} is not prepare-visible`,
        );
      }
      const effectDelta = (visibility & EFFECT_VISIBLE_UNIT) === 0 ? 0 : 1;
      if (slice.prepareLength < 1 || slice.effectLength < effectDelta) {
        throw new Error("Placeholder slice cache disagrees with logical state");
      }
    } catch (error) {
      this.structuralOperationCount = operationCountBeforeValidation;
      throw error;
    }

    const absoluteOffset = slice.start + localOffset;
    this.ensureLogicalBoundary(absoluteOffset);
    this.ensureLogicalBoundary(absoluteOffset + 1);
    const node = this.boundaryNodes.get(absoluteOffset);
    if (node === undefined || node.spanLength !== 1) {
      throw new Error(`Missing scalar placeholder segment ${absoluteOffset}`);
    }
    this.deleteVisibleUnitNode(node);

    const deletedEffectLength =
      (visibility & EFFECT_VISIBLE_UNIT) === 0 ? 0 : 1;
    slice.adjustCachedLengths(-1, -deletedEffectLength);
    return deletedEffectLength;
  }

  /**
   * Hot replay variant for a delete already landed inside one physical slice.
   * The selected ranges all have zero cover, and the split middle exposes its
   * old effect width before hiding, so cached weights can be adjusted without
   * four extra prefix queries per scalar event.
   */
  deletePrepareVisibleInSlice(
    slice: PlaceholderPhysicalSlice<Owner>,
    localStart: number,
    maxLength: number,
  ): PlaceholderDeleteResult<Owner> {
    this.assertOwnedSlice(slice);
    if (
      !Number.isSafeInteger(localStart) ||
      localStart < 0 ||
      localStart >= slice.length
    ) {
      throw new Error(
        `Invalid placeholder delete offset ${localStart} for slice length ${slice.length}`,
      );
    }
    const ranges = this.collectPrepareVisibleRanges(
      slice.start + localStart,
      slice.end,
      maxLength,
    );
    let deletedPrepareLength = 0;
    let deletedEffectLength = 0;
    for (const range of ranges) {
      this.mutateRange(range.start, range.end, 1, true);
      deletedPrepareLength += this.mutationPrepareLengthBefore;
      deletedEffectLength += this.mutationEffectLengthBefore;
    }
    if (deletedPrepareLength > 0 || deletedEffectLength > 0) {
      slice.adjustCachedLengths(-deletedPrepareLength, -deletedEffectLength);
    }
    return { ranges, deletedEffectLength, affectedSlices: [slice] };
  }

  /**
   * Initial application of a known logical target. Unlike
   * `deletePrepareVisible`, this does not skip already-covered code units.
   */
  applyDeleteRange(
    start: number,
    end: number,
  ): ReadonlyArray<PlaceholderPhysicalSlice<Owner>> {
    this.assertRange(start, end);
    this.mutateRange(start, end, 1, true);
    return this.refreshSlicesForRanges([{ start, end }]);
  }

  /** Retreat (-1) or advance (+1) a previously recorded delete target. */
  adjustPrepareRange(
    start: number,
    end: number,
    delta: 1 | -1,
  ): ReadonlyArray<PlaceholderPhysicalSlice<Owner>> {
    this.assertRange(start, end);
    this.mutateRange(start, end, delta, false);
    const affectedSlices = this.slicesOverlapping(start, end);
    for (const slice of affectedSlices) {
      slice.setCachedLengths(
        this.prepareLengthInRange(slice.start, slice.end),
        slice.effectLength,
      );
    }
    return affectedSlices;
  }

  slicesOverlapping(
    start: number,
    end: number,
  ): ReadonlyArray<PlaceholderPhysicalSlice<Owner>> {
    this.assertRangeAllowEmpty(start, end);
    if (start === end || this.sliceRoot === null) {
      return [];
    }
    const slices: PlaceholderPhysicalSlice<Owner>[] = [];
    this.collectOverlappingSlices(this.sliceRoot, start, end, slices);
    return slices;
  }

  logicalSegments(): ReadonlyArray<PlaceholderLogicalSegment> {
    const segments: PlaceholderLogicalSegment[] = [];
    this.forEachLogicalSegment((segment) => segments.push(segment));
    return segments;
  }

  logicalSegmentsInRange(
    start: number,
    end: number,
  ): ReadonlyArray<PlaceholderLogicalSegment> {
    this.assertRangeAllowEmpty(start, end);
    const segments: PlaceholderLogicalSegment[] = [];
    this.visitLogicalSegments(start, end, (segment) => {
      segments.push(segment);
      return true;
    });
    return segments;
  }

  forEachLogicalSegment(
    visitor: (segment: PlaceholderLogicalSegment) => void,
  ): void {
    this.visitLogicalSegments(0, this.length, (segment) => {
      visitor(segment);
      return true;
    });
  }

  private preparePrefix(offset: number): number {
    return this.weightPrefix(offset, "prepare");
  }

  private effectPrefix(offset: number): number {
    return this.weightPrefix(offset, "effect");
  }

  private weightPrefix(offset: number, kind: "prepare" | "effect"): number {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.length) {
      throw new Error(`Invalid placeholder prefix offset ${offset}`);
    }
    let remaining = offset;
    let result = 0;
    let current: SegmentNode | null = this.root;
    while (current !== null && remaining > 0) {
      this.structuralOperationCount++;
      this.push(current);
      const leftLength = nodeLength(current.left);
      if (remaining <= leftLength) {
        current = current.left;
        continue;
      }

      result += this.nodeVisibleLength(current.left, kind);
      remaining -= leftLength;
      const ownLength = Math.min(remaining, current.spanLength);
      result +=
        kind === "prepare"
          ? current.cover === 0
            ? ownLength
            : 0
          : current.effectVisible
            ? ownLength
            : 0;
      remaining -= ownLength;
      if (remaining === 0) {
        break;
      }
      current = current.right;
    }
    return result;
  }

  private selectPrepareOffset(rank: number): number {
    if (!Number.isSafeInteger(rank) || rank < 0 || rank >= this.prepareLength) {
      throw new Error(`Invalid placeholder prepare rank ${rank}`);
    }
    let remaining = rank;
    let contentOffset = 0;
    let current: SegmentNode | null = this.root;
    while (current !== null) {
      this.structuralOperationCount++;
      this.push(current);
      const leftVisible = visiblePrepareLength(current.left);
      if (remaining < leftVisible) {
        current = current.left;
        continue;
      }
      remaining -= leftVisible;
      contentOffset += nodeLength(current.left);
      if (current.cover === 0) {
        if (remaining < current.spanLength) {
          return contentOffset + remaining;
        }
        remaining -= current.spanLength;
      }
      contentOffset += current.spanLength;
      current = current.right;
    }
    throw new Error(`Placeholder prepare rank ${rank} escaped the treap`);
  }

  private unitVisibilityAtContentOffset(offset: number): number {
    let node: SegmentNode | null = this.root;
    let remaining = offset;
    let inheritedCover = 0;
    let inheritedEffectHidden = false;
    while (node !== null) {
      this.structuralOperationCount++;
      const leftLength = nodeLength(node.left);
      if (remaining < leftLength) {
        inheritedCover += node.lazyCoverDelta;
        inheritedEffectHidden ||= node.lazyHideEffect;
        node = node.left;
        continue;
      }
      if (remaining < leftLength + node.spanLength) {
        return (
          (node.cover + inheritedCover === 0 ? PREPARE_VISIBLE_UNIT : 0) |
          (!inheritedEffectHidden && node.effectVisible
            ? EFFECT_VISIBLE_UNIT
            : 0)
        );
      }
      remaining -= leftLength + node.spanLength;
      inheritedCover += node.lazyCoverDelta;
      inheritedEffectHidden ||= node.lazyHideEffect;
      node = node.right;
    }
    throw new Error(`Placeholder offset ${offset} escaped the segment tree`);
  }

  private mutateRange(
    start: number,
    end: number,
    coverDelta: number,
    hideEffect: boolean,
  ): void {
    if (start === end) {
      this.mutationPrepareLengthBefore = 0;
      this.mutationEffectLengthBefore = 0;
      return;
    }
    if (this.tryMutateSingleSegment(start, end, coverDelta, hideEffect)) {
      return;
    }

    const prepareBeforeValidation = this.mutationPrepareLengthBefore;
    const effectBeforeValidation = this.mutationEffectLengthBefore;
    let hasPreflight = false;
    if (coverDelta < 0) {
      const operationCountBeforeValidation = this.structuralOperationCount;
      this.measureRange(start, end);
      hasPreflight = true;
      if (this.mutationPrepareLengthBefore > 0) {
        this.structuralOperationCount = operationCountBeforeValidation;
        this.mutationPrepareLengthBefore = prepareBeforeValidation;
        this.mutationEffectLengthBefore = effectBeforeValidation;
        throw new Error(
          `Placeholder prepare coverage would become negative in [${start}, ${end})`,
        );
      }
    }

    this.ensureLogicalBoundary(start);
    this.ensureLogicalBoundary(end);
    if (this.tryMutateSingleSegment(start, end, coverDelta, hideEffect)) {
      return;
    }

    if (!hasPreflight) {
      this.measureRange(start, end);
    }
    this.applyRange(this.root, 0, start, end, coverDelta, hideEffect);
  }

  private deleteVisibleUnitNode(node: SegmentNode): void {
    this.directPathNodes.length = 0;
    let current: SegmentNode | null = node;
    while (current !== null) {
      this.structuralOperationCount++;
      this.directPathNodes.push(current);
      current = current.parent;
    }
    for (let index = this.directPathNodes.length - 1; index >= 0; index--) {
      this.push(this.directPathNodes[index]!);
    }
    if (node.cover !== 0) {
      throw new Error("Placeholder scalar target is not prepare-visible");
    }
    node.cover = 1;
    node.effectVisible = false;
    for (let index = 0; index < this.directPathNodes.length; index++) {
      this.updateNode(this.directPathNodes[index]!);
    }
  }

  private tryMutateSingleSegment(
    start: number,
    end: number,
    coverDelta: number,
    hideEffect: boolean,
  ): boolean {
    const node = this.boundaryNodes.get(start);
    if (node === undefined || node.spanLength !== end - start) {
      return false;
    }

    const operationCountBeforeValidation = this.structuralOperationCount;
    const prepareBeforeValidation = this.mutationPrepareLengthBefore;
    const effectBeforeValidation = this.mutationEffectLengthBefore;
    this.directPathNodes.length = 0;
    let inheritedCover = 0;
    let inheritedEffectHidden = false;
    let current: SegmentNode | null = node;
    while (current !== null) {
      this.structuralOperationCount++;
      this.directPathNodes.push(current);
      const parent: SegmentNode | null = current.parent;
      if (parent !== null) {
        inheritedCover += parent.lazyCoverDelta;
        inheritedEffectHidden ||= parent.lazyHideEffect;
      }
      current = parent;
    }

    const effectiveCover = node.cover + inheritedCover;
    this.mutationPrepareLengthBefore =
      effectiveCover === 0 ? node.spanLength : 0;
    this.mutationEffectLengthBefore =
      !inheritedEffectHidden && node.effectVisible ? node.spanLength : 0;
    if (coverDelta < 0 && effectiveCover + coverDelta < 0) {
      this.structuralOperationCount = operationCountBeforeValidation;
      this.mutationPrepareLengthBefore = prepareBeforeValidation;
      this.mutationEffectLengthBefore = effectBeforeValidation;
      throw new Error(
        `Placeholder prepare coverage would become negative in [${start}, ${end})`,
      );
    }

    for (let index = this.directPathNodes.length - 1; index >= 0; index--) {
      this.push(this.directPathNodes[index]!);
    }
    if (coverDelta !== 0) {
      const nextCover = node.cover + coverDelta;
      if (!Number.isSafeInteger(nextCover)) {
        throw new Error(
          "Placeholder prepare coverage exceeded safe integer range",
        );
      }
      node.cover = nextCover;
    }
    if (hideEffect) {
      node.effectVisible = false;
    }
    for (let index = 0; index < this.directPathNodes.length; index++) {
      this.updateNode(this.directPathNodes[index]!);
    }
    return true;
  }

  private measureRange(start: number, end: number): void {
    this.mutationPrepareLengthBefore = 0;
    this.mutationEffectLengthBefore = 0;
    this.measureRangeReadOnly(this.root, 0, start, end, 0, false);
  }

  private measureRangeReadOnly(
    node: SegmentNode | null,
    subtreeStart: number,
    start: number,
    end: number,
    inheritedCover: number,
    inheritedEffectHidden: boolean,
  ): void {
    if (
      node === null ||
      end <= subtreeStart ||
      start >= subtreeStart + node.subtreeLength
    ) {
      return;
    }
    this.structuralOperationCount++;
    const subtreeEnd = subtreeStart + node.subtreeLength;
    if (start <= subtreeStart && subtreeEnd <= end) {
      if (node.minCover + inheritedCover === 0) {
        this.mutationPrepareLengthBefore += node.minCoverLength;
      }
      if (!inheritedEffectHidden) {
        this.mutationEffectLengthBefore += node.effectVisibleLength;
      }
      return;
    }

    const nodeStart = subtreeStart + nodeLength(node.left);
    const childCover = inheritedCover + node.lazyCoverDelta;
    const childEffectHidden = inheritedEffectHidden || node.lazyHideEffect;
    this.measureRangeReadOnly(
      node.left,
      subtreeStart,
      start,
      end,
      childCover,
      childEffectHidden,
    );
    const ownStart = Math.max(start, nodeStart);
    const ownEnd = Math.min(end, nodeStart + node.spanLength);
    if (ownStart < ownEnd) {
      const ownLength = ownEnd - ownStart;
      if (node.cover + inheritedCover === 0) {
        this.mutationPrepareLengthBefore += ownLength;
      }
      if (!inheritedEffectHidden && node.effectVisible) {
        this.mutationEffectLengthBefore += ownLength;
      }
    }
    this.measureRangeReadOnly(
      node.right,
      nodeStart + node.spanLength,
      start,
      end,
      childCover,
      childEffectHidden,
    );
  }

  private applyRange(
    node: SegmentNode | null,
    subtreeStart: number,
    start: number,
    end: number,
    coverDelta: number,
    hideEffect: boolean,
  ): void {
    if (
      node === null ||
      end <= subtreeStart ||
      start >= subtreeStart + node.subtreeLength
    ) {
      return;
    }
    this.structuralOperationCount++;
    const subtreeEnd = subtreeStart + node.subtreeLength;
    if (start <= subtreeStart && subtreeEnd <= end) {
      if (coverDelta !== 0) {
        this.applyCoverDelta(node, coverDelta);
      }
      if (hideEffect) {
        this.applyHideEffect(node);
      }
      return;
    }

    this.push(node);
    const nodeStart = subtreeStart + nodeLength(node.left);
    this.applyRange(
      node.left,
      subtreeStart,
      start,
      end,
      coverDelta,
      hideEffect,
    );
    if (start < nodeStart + node.spanLength && end > nodeStart) {
      if (start > nodeStart || end < nodeStart + node.spanLength) {
        throw new Error(
          `Unaligned placeholder mutation [${start}, ${end}) crossed segment ` +
            `[${nodeStart}, ${nodeStart + node.spanLength})`,
        );
      }
      if (coverDelta !== 0) {
        const nextCover = node.cover + coverDelta;
        if (!Number.isSafeInteger(nextCover)) {
          throw new Error(
            "Placeholder prepare coverage exceeded safe integer range",
          );
        }
        node.cover = nextCover;
      }
      if (hideEffect) {
        node.effectVisible = false;
      }
    }
    this.applyRange(
      node.right,
      nodeStart + node.spanLength,
      start,
      end,
      coverDelta,
      hideEffect,
    );
    this.updateNode(node);
  }

  private ensureLogicalBoundary(offset: number): void {
    if (offset === 0 || offset === this.length) {
      return;
    }
    if (this.boundaryNodes.has(offset)) {
      return;
    }
    this.insertLogicalBoundary(offset);
  }

  private insertLogicalBoundary(offset: number): void {
    this.directPathNodes.length = 0;
    let node: SegmentNode | null = this.root;
    let subtreeStart = 0;
    let nodeStart = 0;
    while (node !== null) {
      this.structuralOperationCount++;
      this.directPathNodes.push(node);
      const leftLength = nodeLength(node.left);
      nodeStart = subtreeStart + leftLength;
      if (offset < nodeStart) {
        node = node.left;
      } else if (offset > nodeStart + node.spanLength) {
        subtreeStart = nodeStart + node.spanLength;
        node = node.right;
      } else if (
        offset === nodeStart ||
        offset === nodeStart + node.spanLength
      ) {
        throw new Error(`Unindexed logical placeholder boundary ${offset}`);
      } else {
        break;
      }
    }
    if (node === null) {
      throw new Error(`Missing logical placeholder boundary ${offset}`);
    }

    // Allocate and validate the stable ID before changing span lengths or
    // topology. Lazy propagation below is therefore entered only after the
    // external allocator has succeeded.
    const rightId = this.allocateFreshSegmentId();
    for (let index = 0; index < this.directPathNodes.length; index++) {
      this.push(this.directPathNodes[index]!);
    }

    const oldRight = node.right;
    let successorParent: SegmentNode = node;
    if (oldRight !== null) {
      let successor = oldRight;
      while (true) {
        this.structuralOperationCount++;
        this.push(successor);
        if (successor.left === null) {
          successorParent = successor;
          break;
        }
        successor = successor.left;
      }
    }

    const localOffset = offset - nodeStart;
    const right = createSegmentNode(
      rightId,
      node.spanLength - localOffset,
      node.cover,
      node.effectVisible,
    );
    node.spanLength = localOffset;
    if (oldRight === null) {
      node.right = right;
    } else {
      successorParent.left = right;
    }
    right.parent = successorParent;

    let current: SegmentNode | null = successorParent;
    while (current !== null) {
      this.structuralOperationCount++;
      this.updateNode(current);
      current = current.parent;
    }

    while (right.parent !== null && comparePriority(right, right.parent) < 0) {
      const parent = right.parent;
      if (parent.left === right) {
        this.rotateSegmentRight(parent);
      } else if (parent.right === right) {
        this.rotateSegmentLeft(parent);
      } else {
        throw new Error("Placeholder segment parent link is inconsistent");
      }
    }
    this.boundaryNodes.set(offset, right);
    this.root.parent = null;
  }

  private rotateSegmentLeft(pivot: SegmentNode): void {
    const child = pivot.right;
    if (child === null) {
      throw new Error("Cannot rotate placeholder segment tree left");
    }
    this.structuralOperationCount++;
    this.push(pivot);
    this.push(child);
    const grandparent = pivot.parent;
    const transfer = child.left;
    pivot.right = transfer;
    if (transfer !== null) {
      transfer.parent = pivot;
    }
    child.left = pivot;
    pivot.parent = child;
    child.parent = grandparent;
    if (grandparent === null) {
      this.root = child;
    } else if (grandparent.left === pivot) {
      grandparent.left = child;
    } else if (grandparent.right === pivot) {
      grandparent.right = child;
    } else {
      throw new Error("Placeholder segment grandparent link is inconsistent");
    }
    this.updateNode(pivot);
    this.updateNode(child);
  }

  private rotateSegmentRight(pivot: SegmentNode): void {
    const child = pivot.left;
    if (child === null) {
      throw new Error("Cannot rotate placeholder segment tree right");
    }
    this.structuralOperationCount++;
    this.push(pivot);
    this.push(child);
    const grandparent = pivot.parent;
    const transfer = child.right;
    pivot.left = transfer;
    if (transfer !== null) {
      transfer.parent = pivot;
    }
    child.right = pivot;
    pivot.parent = child;
    child.parent = grandparent;
    if (grandparent === null) {
      this.root = child;
    } else if (grandparent.left === pivot) {
      grandparent.left = child;
    } else if (grandparent.right === pivot) {
      grandparent.right = child;
    } else {
      throw new Error("Placeholder segment grandparent link is inconsistent");
    }
    this.updateNode(pivot);
    this.updateNode(child);
  }

  private applyCoverDelta(node: SegmentNode, delta: number): void {
    const nextCover = node.cover + delta;
    const nextMinimum = node.minCover + delta;
    const nextLazy = node.lazyCoverDelta + delta;
    if (
      !Number.isSafeInteger(nextCover) ||
      !Number.isSafeInteger(nextMinimum) ||
      !Number.isSafeInteger(nextLazy)
    ) {
      throw new Error(
        "Placeholder prepare coverage exceeded safe integer range",
      );
    }
    node.cover = nextCover;
    node.minCover = nextMinimum;
    node.lazyCoverDelta = nextLazy;
  }

  private applyHideEffect(node: SegmentNode): void {
    node.effectVisible = false;
    node.effectVisibleLength = 0;
    node.lazyHideEffect = true;
  }

  private push(node: SegmentNode): void {
    if (node.lazyCoverDelta !== 0) {
      const delta = node.lazyCoverDelta;
      if (node.left !== null) {
        this.applyCoverDelta(node.left, delta);
      }
      if (node.right !== null) {
        this.applyCoverDelta(node.right, delta);
      }
      node.lazyCoverDelta = 0;
    }
    if (node.lazyHideEffect) {
      if (node.left !== null) {
        this.applyHideEffect(node.left);
      }
      if (node.right !== null) {
        this.applyHideEffect(node.right);
      }
      node.lazyHideEffect = false;
    }
  }

  private updateNode(node: SegmentNode): void {
    const left = node.left;
    const right = node.right;
    node.subtreeLength = nodeLength(left) + node.spanLength + nodeLength(right);
    node.effectVisibleLength =
      nodeEffectLength(left) +
      (node.effectVisible ? node.spanLength : 0) +
      nodeEffectLength(right);

    const minimum = Math.min(
      left?.minCover ?? Number.POSITIVE_INFINITY,
      node.cover,
      right?.minCover ?? Number.POSITIVE_INFINITY,
    );
    node.minCover = minimum;
    node.minCoverLength =
      (left?.minCover === minimum ? left.minCoverLength : 0) +
      (node.cover === minimum ? node.spanLength : 0) +
      (right?.minCover === minimum ? right.minCoverLength : 0);
  }

  private nodeVisibleLength(
    node: SegmentNode | null,
    kind: "prepare" | "effect",
  ): number {
    return kind === "prepare"
      ? visiblePrepareLength(node)
      : nodeEffectLength(node);
  }

  private visitLogicalSegments(
    start: number,
    end: number,
    visitor: (segment: PlaceholderLogicalSegment) => boolean,
  ): void {
    this.visitNodesInRange(this.root, 0, start, end, (node, nodeStart) => {
      const segmentStart = Math.max(start, nodeStart);
      const segmentEnd = Math.min(end, nodeStart + node.spanLength);
      return visitor({
        id: node.id,
        start: segmentStart,
        end: segmentEnd,
        prepareState: node.cover + 1,
        everDeleted: !node.effectVisible,
      });
    });
  }

  private visitNodesInRange(
    node: SegmentNode | null,
    subtreeStart: number,
    start: number,
    end: number,
    visitor: (node: SegmentNode, nodeStart: number) => boolean,
  ): boolean {
    if (
      node === null ||
      end <= subtreeStart ||
      start >= subtreeStart + node.subtreeLength
    ) {
      return true;
    }
    this.structuralOperationCount++;
    this.push(node);
    const nodeStart = subtreeStart + nodeLength(node.left);
    if (!this.visitNodesInRange(node.left, subtreeStart, start, end, visitor)) {
      return false;
    }
    if (
      start < nodeStart + node.spanLength &&
      end > nodeStart &&
      !visitor(node, nodeStart)
    ) {
      return false;
    }
    return this.visitNodesInRange(
      node.right,
      nodeStart + node.spanLength,
      start,
      end,
      visitor,
    );
  }

  private refreshSlicesForRanges(
    ranges: ReadonlyArray<PlaceholderRange>,
  ): ReadonlyArray<PlaceholderPhysicalSlice<Owner>> {
    const affected = new Set<PlaceholderPhysicalSlice<Owner>>();
    for (const range of ranges) {
      for (const slice of this.slicesOverlapping(range.start, range.end)) {
        affected.add(slice);
      }
    }
    for (const slice of affected) {
      this.refreshSlice(slice);
    }
    return [...affected];
  }

  private refreshSlice(slice: PlaceholderPhysicalSlice<Owner>): void {
    slice.setCachedLengths(
      this.prepareLengthInRange(slice.start, slice.end),
      this.effectLengthInRange(slice.start, slice.end),
    );
  }

  private assertOwnedSlice(slice: PlaceholderPhysicalSlice<Owner>): void {
    if (slice.state !== this) {
      throw new Error("Placeholder slice belongs to a different state");
    }
    const registered = this.findSliceByStart(slice.start);
    if (registered !== slice) {
      throw new Error("Placeholder slice is not registered");
    }
  }

  private insertSliceNode(
    node: SliceNode<Owner> | null,
    slice: PlaceholderPhysicalSlice<Owner>,
  ): SliceNode<Owner> {
    if (node === null) {
      this.structuralOperationCount++;
      return createSliceNode(slice);
    }
    this.structuralOperationCount++;
    if (slice.end <= node.slice.start) {
      node.left = this.insertSliceNode(node.left, slice);
    } else if (slice.start >= node.slice.end) {
      node.right = this.insertSliceNode(node.right, slice);
    } else {
      throw new Error(
        `Placeholder physical slices overlap: [${slice.start}, ${slice.end}) and ` +
          `[${node.slice.start}, ${node.slice.end})`,
      );
    }
    return this.rebalanceSliceNode(node);
  }

  private findSliceByStart(
    start: number,
  ): PlaceholderPhysicalSlice<Owner> | null {
    let node = this.sliceRoot;
    while (node !== null) {
      this.structuralOperationCount++;
      if (start === node.slice.start) {
        return node.slice;
      }
      node = start < node.slice.start ? node.left : node.right;
    }
    return null;
  }

  private collectOverlappingSlices(
    node: SliceNode<Owner> | null,
    start: number,
    end: number,
    output: PlaceholderPhysicalSlice<Owner>[],
  ): void {
    if (node === null) {
      return;
    }
    this.structuralOperationCount++;
    if (start < node.slice.start) {
      this.collectOverlappingSlices(node.left, start, end, output);
    }
    if (node.slice.start < end && node.slice.end > start) {
      output.push(node.slice);
    }
    if (end > node.slice.end) {
      this.collectOverlappingSlices(node.right, start, end, output);
    }
  }

  private rebalanceSliceNode(node: SliceNode<Owner>): SliceNode<Owner> {
    updateSliceHeight(node);
    const balance = sliceHeight(node.left) - sliceHeight(node.right);
    if (balance > 1) {
      if (sliceHeight(node.left!.left) < sliceHeight(node.left!.right)) {
        node.left = this.rotateSliceLeft(node.left!);
      }
      return this.rotateSliceRight(node);
    }
    if (balance < -1) {
      if (sliceHeight(node.right!.right) < sliceHeight(node.right!.left)) {
        node.right = this.rotateSliceRight(node.right!);
      }
      return this.rotateSliceLeft(node);
    }
    return node;
  }

  private rotateSliceLeft(root: SliceNode<Owner>): SliceNode<Owner> {
    this.structuralOperationCount++;
    const pivot = root.right;
    if (pivot === null) {
      throw new Error("Cannot rotate placeholder slice tree left");
    }
    root.right = pivot.left;
    pivot.left = root;
    updateSliceHeight(root);
    updateSliceHeight(pivot);
    return pivot;
  }

  private rotateSliceRight(root: SliceNode<Owner>): SliceNode<Owner> {
    this.structuralOperationCount++;
    const pivot = root.left;
    if (pivot === null) {
      throw new Error("Cannot rotate placeholder slice tree right");
    }
    root.left = pivot.right;
    pivot.right = root;
    updateSliceHeight(root);
    updateSliceHeight(pivot);
    return pivot;
  }

  private allocateFreshSegmentId(): EventId {
    const id = this.allocateSegmentId();
    this.assertFreshSegmentId(id);
    return id;
  }

  private assertFreshSegmentId(id: EventId): void {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Placeholder segment ID must be a non-empty string");
    }
    if (this.allocatedSegmentIds.has(id)) {
      throw new Error(`Duplicate placeholder segment ID ${id}`);
    }
    this.allocatedSegmentIds.add(id);
  }

  private assertRange(start: number, end: number): void {
    this.assertRangeAllowEmpty(start, end);
    if (start === end) {
      throw new Error(`Placeholder range [${start}, ${end}) is empty`);
    }
  }

  private assertRangeAllowEmpty(start: number, end: number): void {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.length
    ) {
      throw new Error(
        `Invalid placeholder range [${start}, ${end}) for length ${this.length}`,
      );
    }
  }
}

const createSegmentNode = (
  id: EventId,
  spanLength: number,
  cover: number,
  effectVisible: boolean,
): SegmentNode => ({
  id,
  priority: stableHash(id),
  spanLength,
  cover,
  effectVisible,
  parent: null,
  left: null,
  right: null,
  subtreeLength: spanLength,
  minCover: cover,
  minCoverLength: spanLength,
  effectVisibleLength: effectVisible ? spanLength : 0,
  lazyCoverDelta: 0,
  lazyHideEffect: false,
});

const nodeLength = (node: SegmentNode | null): number =>
  node?.subtreeLength ?? 0;

const nodeEffectLength = (node: SegmentNode | null): number =>
  node?.effectVisibleLength ?? 0;

const visiblePrepareLength = (node: SegmentNode | null): number =>
  node !== null && node.minCover === 0 ? node.minCoverLength : 0;

const comparePriority = (left: SegmentNode, right: SegmentNode): number =>
  left.priority !== right.priority
    ? left.priority - right.priority
    : left.id < right.id
      ? -1
      : left.id > right.id
        ? 1
        : 0;

const stableHash = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const appendRange = (
  ranges: PlaceholderRange[],
  start: number,
  end: number,
): void => {
  const previous = ranges[ranges.length - 1];
  if (previous !== undefined && previous.end === start) {
    ranges[ranges.length - 1] = { start: previous.start, end };
  } else {
    ranges.push({ start, end });
  }
};

const createSliceNode = <Owner extends object>(
  slice: PlaceholderPhysicalSlice<Owner>,
): SliceNode<Owner> => ({ slice, left: null, right: null, height: 1 });

const sliceHeight = <Owner extends object>(
  node: SliceNode<Owner> | null,
): number => node?.height ?? 0;

const updateSliceHeight = <Owner extends object>(
  node: SliceNode<Owner>,
): void => {
  node.height = 1 + Math.max(sliceHeight(node.left), sliceHeight(node.right));
};

const countSliceNodes = <Owner extends object>(
  node: SliceNode<Owner> | null,
): number =>
  node === null
    ? 0
    : 1 + countSliceNodes(node.left) + countSliceNodes(node.right);

const assertPositiveSafeInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label} ${value}`);
  }
};
