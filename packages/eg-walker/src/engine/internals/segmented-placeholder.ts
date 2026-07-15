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

interface RangeMutationSummary {
  readonly prepareLengthBefore: number;
  readonly effectLengthBefore: number;
}

interface SegmentNode {
  readonly id: EventId;
  readonly priority: number;
  spanLength: number;
  cover: number;
  effectVisible: boolean;
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
  private structuralOperationCount = 0;

  constructor(
    readonly length: number,
    initialSegmentId: EventId,
    private readonly allocateSegmentId: () => EventId,
  ) {
    assertPositiveSafeInteger(length, "placeholder length");
    this.assertFreshSegmentId(initialSegmentId);
    this.root = createSegmentNode(initialSegmentId, length, 0, true);
  }

  get prepareLength(): number {
    return visiblePrepareLength(this.root);
  }

  get effectLength(): number {
    return this.root.effectVisibleLength;
  }

  get logicalSegmentCount(): number {
    let count = 0;
    this.forEachLogicalSegment(() => {
      count++;
    });
    return count;
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
    const node = this.findSegmentAtContentOffset(offset);
    if (node === null || node.start !== offset) {
      throw new Error(`Missing logical placeholder boundary ${offset}`);
    }
    return node.node.id;
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
      const summary = this.mutateRange(range.start, range.end, 1, true);
      deletedPrepareLength += summary.prepareLengthBefore;
      deletedEffectLength += summary.effectLengthBefore;
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
    if (delta < 0 && this.minCoverInRange(start, end) === 0) {
      throw new Error(
        `Placeholder prepare coverage would become negative in [${start}, ${end})`,
      );
    }
    const affectedSlices = this.slicesOverlapping(start, end);
    this.mutateRange(start, end, delta, false);
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

  private minCoverInRange(start: number, end: number): number {
    const minimum = this.queryMinCover(this.root, 0, start, end);
    if (!Number.isFinite(minimum)) {
      throw new Error(`Missing placeholder coverage in [${start}, ${end})`);
    }
    return minimum;
  }

  private queryMinCover(
    node: SegmentNode | null,
    subtreeStart: number,
    start: number,
    end: number,
  ): number {
    if (
      node === null ||
      end <= subtreeStart ||
      start >= subtreeStart + node.subtreeLength
    ) {
      return Number.POSITIVE_INFINITY;
    }
    this.structuralOperationCount++;
    if (start <= subtreeStart && subtreeStart + node.subtreeLength <= end) {
      return node.minCover;
    }

    this.push(node);
    const nodeStart = subtreeStart + nodeLength(node.left);
    let minimum = this.queryMinCover(node.left, subtreeStart, start, end);
    if (start < nodeStart + node.spanLength && end > nodeStart) {
      minimum = Math.min(minimum, node.cover);
    }
    return Math.min(
      minimum,
      this.queryMinCover(node.right, nodeStart + node.spanLength, start, end),
    );
  }

  private mutateRange(
    start: number,
    end: number,
    coverDelta: number,
    hideEffect: boolean,
  ): RangeMutationSummary {
    if (start === end) {
      return { prepareLengthBefore: 0, effectLengthBefore: 0 };
    }
    const [left, tail] = this.splitNode(this.root, start);
    if (tail === null) {
      throw new Error(`Missing placeholder range tail at ${start}`);
    }
    const [middle, right] = this.splitNode(tail, end - start);
    if (middle === null) {
      throw new Error(`Missing placeholder range [${start}, ${end})`);
    }
    if (coverDelta < 0 && middle.minCover + coverDelta < 0) {
      this.root = this.mergeNodes(left, this.mergeNodes(middle, right))!;
      throw new Error(
        `Placeholder prepare coverage would become negative in [${start}, ${end})`,
      );
    }
    const summary: RangeMutationSummary = {
      prepareLengthBefore: visiblePrepareLength(middle),
      effectLengthBefore: middle.effectVisibleLength,
    };
    if (coverDelta !== 0) {
      this.applyCoverDelta(middle, coverDelta);
    }
    if (hideEffect) {
      this.applyHideEffect(middle);
    }
    this.root = this.mergeNodes(left, this.mergeNodes(middle, right))!;
    return summary;
  }

  private ensureLogicalBoundary(offset: number): void {
    if (offset === 0 || offset === this.length) {
      return;
    }
    const found = this.findSegmentAtContentOffset(offset);
    if (found !== null && found.start === offset) {
      return;
    }
    const [left, right] = this.splitNode(this.root, offset);
    this.root = this.mergeNodes(left, right)!;
  }

  private findSegmentAtContentOffset(
    offset: number,
  ): { readonly node: SegmentNode; readonly start: number } | null {
    let current: SegmentNode | null = this.root;
    let remaining = offset;
    let start = 0;
    while (current !== null) {
      this.structuralOperationCount++;
      this.push(current);
      const leftLength = nodeLength(current.left);
      if (remaining < leftLength) {
        current = current.left;
      } else if (remaining < leftLength + current.spanLength) {
        return { node: current, start: start + leftLength };
      } else {
        remaining -= leftLength + current.spanLength;
        start += leftLength + current.spanLength;
        current = current.right;
      }
    }
    return null;
  }

  private splitNode(
    node: SegmentNode | null,
    offset: number,
  ): readonly [SegmentNode | null, SegmentNode | null] {
    if (node === null) {
      if (offset !== 0) {
        throw new Error(`Placeholder split ${offset} escaped an empty subtree`);
      }
      return [null, null];
    }
    this.structuralOperationCount++;
    if (offset === 0) {
      return [null, node];
    }
    if (offset === node.subtreeLength) {
      return [node, null];
    }
    if (offset < 0 || offset > node.subtreeLength) {
      throw new Error(
        `Placeholder split ${offset} exceeds subtree length ${node.subtreeLength}`,
      );
    }

    this.push(node);
    const leftLength = nodeLength(node.left);
    if (offset < leftLength) {
      const [left, remainder] = this.splitNode(node.left, offset);
      node.left = remainder;
      this.updateNode(node);
      return [left, node];
    }
    if (offset > leftLength + node.spanLength) {
      const [remainder, right] = this.splitNode(
        node.right,
        offset - leftLength - node.spanLength,
      );
      node.right = remainder;
      this.updateNode(node);
      return [node, right];
    }
    if (offset === leftLength) {
      const left = node.left;
      node.left = null;
      this.updateNode(node);
      return [left, node];
    }
    if (offset === leftLength + node.spanLength) {
      const right = node.right;
      node.right = null;
      this.updateNode(node);
      return [node, right];
    }

    const localOffset = offset - leftLength;
    const leftSubtree = node.left;
    const rightSubtree = node.right;
    const leftChunk = createSegmentNode(
      node.id,
      localOffset,
      node.cover,
      node.effectVisible,
    );
    const rightId = this.allocateFreshSegmentId();
    const rightChunk = createSegmentNode(
      rightId,
      node.spanLength - localOffset,
      node.cover,
      node.effectVisible,
    );
    return [
      this.mergeNodes(leftSubtree, leftChunk),
      this.mergeNodes(rightChunk, rightSubtree),
    ];
  }

  private mergeNodes(
    left: SegmentNode | null,
    right: SegmentNode | null,
  ): SegmentNode | null {
    if (left === null) {
      return right;
    }
    if (right === null) {
      return left;
    }
    this.structuralOperationCount++;
    if (comparePriority(left, right) <= 0) {
      this.push(left);
      left.right = this.mergeNodes(left.right, right);
      this.updateNode(left);
      return left;
    }
    this.push(right);
    right.left = this.mergeNodes(left, right.left);
    this.updateNode(right);
    return right;
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
