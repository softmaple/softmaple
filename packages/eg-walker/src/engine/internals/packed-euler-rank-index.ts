const MARKERS_PER_NODE = 3;
const MAX_MARKER_ID = 0xffff_ffff;
const MAX_NODE_HANDLE = Math.floor(
  (MAX_MARKER_ID - (MARKERS_PER_NODE - 1)) / MARKERS_PER_NODE,
);

const LEAF_CAPACITY = 32;
const MAX_INSERT_RUN = MARKERS_PER_NODE;
const BRANCH_FACTOR = 32;

const LOCATION_SLOT_STRIDE = 128;

export const PACKED_EULER_BOUNDARY = {
  Start: 0,
  Visit: 1,
  End: 2,
} as const;

export type PackedEulerBoundary =
  (typeof PACKED_EULER_BOUNDARY)[keyof typeof PACKED_EULER_BOUNDARY];

export type PackedEulerNodeHandle = number;

interface NodeBase {
  parent: InternalNode | null;
  childIndex: number;
  visitCount: number;
}

interface LeafNode extends NodeBase {
  readonly kind: "leaf";
  readonly id: number;
  readonly markers: number[];
}

interface InternalNode extends NodeBase {
  readonly kind: "internal";
  readonly children: TreeNode[];
}

type TreeNode = LeafNode | InternalNode;

/**
 * Ranked, insertion-only Euler sequence specialized for Fugue markers.
 *
 * Every Fugue node owns three stable numeric markers:
 * START, VISIT, and END. Only VISIT contributes one unit to the record rank
 * (the synthetic root VISIT contributes zero). Callers insert relative to a
 * stable marker handle, so the tree needs neither general index lookup nor the
 * prepare/effect/anchor weight arrays maintained by {@link IndexedSequence}.
 *
 * Fixed-capacity leaves keep marker movement bounded while dense numeric
 * arrays map each marker to its encoded leaf and slot without marker or
 * WeakMap location objects. Keeping these short-lived replay indexes in V8's
 * packed integer arrays also avoids retaining cumulative ArrayBuffer backing
 * stores across many transient critical-section engines. Leaf and internal
 * splits are deterministic, giving worst-case logarithmic height independent
 * of event IDs or arrival order.
 */
export class PackedEulerRankIndex {
  private root!: TreeNode;
  private leavesById: Array<LeafNode | undefined> = [];
  private locations: number[] = [];
  private nextLeafId = 1;
  private nextNodeHandle = 1;
  private structuralOperationCount = 0;

  constructor() {
    this.reset();
  }

  /** Reset to the synthetic root and return its node handle. */
  reset(): PackedEulerNodeHandle {
    // Leaf id 0 is the unavailable-location sentinel. Store an explicit value
    // at slot 0 so V8 can keep the following dense ids in a packed array.
    this.leavesById = [undefined];
    this.locations = [];
    this.nextLeafId = 1;
    this.nextNodeHandle = 1;
    this.structuralOperationCount = 0;

    const root = this.createLeaf();
    root.markers.push(
      markerId(0, PACKED_EULER_BOUNDARY.Start),
      markerId(0, PACKED_EULER_BOUNDARY.Visit),
      markerId(0, PACKED_EULER_BOUNDARY.End),
    );
    // The synthetic root VISIT is an ordering sentinel, not a record.
    root.visitCount = 0;
    this.root = root;
    for (let slot = 0; slot < MARKERS_PER_NODE; slot++) {
      this.setLocation(root.markers[slot]!, root, slot);
    }
    return 0;
  }

  allocateNode(): PackedEulerNodeHandle {
    if (this.nextNodeHandle > MAX_NODE_HANDLE) {
      throw new Error("Packed Euler node capacity exceeded");
    }
    return this.nextNodeHandle++;
  }

  /**
   * Insert START/VISIT/END immediately before a stable target marker.
   * Returns the new VISIT's record rank without a second tree walk.
   */
  insertNodeBefore(
    targetNode: PackedEulerNodeHandle,
    targetBoundary: PackedEulerBoundary,
    node: PackedEulerNodeHandle,
  ): number {
    return this.insertNodeBeforeInternal(
      targetNode,
      targetBoundary,
      node,
      true,
    )!;
  }

  /** Insert a node when the caller already knows its document position. */
  insertNodeBeforeUnranked(
    targetNode: PackedEulerNodeHandle,
    targetBoundary: PackedEulerBoundary,
    node: PackedEulerNodeHandle,
  ): void {
    this.insertNodeBeforeInternal(targetNode, targetBoundary, node, false);
  }

  private insertNodeBeforeInternal(
    targetNode: PackedEulerNodeHandle,
    targetBoundary: PackedEulerBoundary,
    node: PackedEulerNodeHandle,
    collectRank: boolean,
  ): number | undefined {
    this.assertAllocatedNode(targetNode);
    this.assertAllocatedNode(node);
    const firstMarker = markerId(node, PACKED_EULER_BOUNDARY.Start);
    this.assertMarkerRunAvailable(firstMarker, MARKERS_PER_NODE);

    const target = this.requireLocation(markerId(targetNode, targetBoundary));
    const rank = collectRank ? this.visitRankBefore(target) : undefined;
    this.insertRun(
      this.leafForLocation(target),
      slotForLocation(target),
      firstMarker,
      MARKERS_PER_NODE,
    );
    return rank;
  }

  /**
   * Insert the right half created by a run/placeholder split.
   *
   * START(right), VISIT(right) follow VISIT(left), while END(right) precedes
   * END(left). Existing right children of `left` are consequently enclosed by
   * the new continuation, matching FugueOrderIndex's forced-parent rewrite.
   */
  insertSplitContinuation(
    leftNode: PackedEulerNodeHandle,
    rightNode: PackedEulerNodeHandle,
  ): void {
    this.assertAllocatedNode(leftNode);
    this.assertAllocatedNode(rightNode);
    if (leftNode === 0) {
      throw new Error("Cannot split the synthetic Euler root");
    }

    const rightStart = markerId(rightNode, PACKED_EULER_BOUNDARY.Start);
    this.assertMarkerRunAvailable(rightStart, MARKERS_PER_NODE);

    const leftVisit = this.requireLocation(
      markerId(leftNode, PACKED_EULER_BOUNDARY.Visit),
    );
    this.insertRun(
      this.leafForLocation(leftVisit),
      slotForLocation(leftVisit) + 1,
      rightStart,
      2,
    );

    // The first insertion may split the leaf, so resolve END(left) again from
    // its stable numeric handle before inserting END(right).
    const leftEnd = this.requireLocation(
      markerId(leftNode, PACKED_EULER_BOUNDARY.End),
    );
    this.insertRun(
      this.leafForLocation(leftEnd),
      slotForLocation(leftEnd),
      markerId(rightNode, PACKED_EULER_BOUNDARY.End),
      1,
    );
  }

  rankOfVisit(node: PackedEulerNodeHandle): number {
    this.assertAllocatedNode(node);
    return this.visitRankBefore(
      this.requireLocation(markerId(node, PACKED_EULER_BOUNDARY.Visit)),
    );
  }

  getStructuralOperationCount(): number {
    return this.structuralOperationCount;
  }

  restoreStructuralOperationCount(count: number): void {
    this.structuralOperationCount = count;
  }

  /** Diagnostic materialization used by focused model tests. */
  getMarkerOrder(): number[] {
    const result: number[] = [];
    this.visitLeaves(this.root, (leaf) => {
      for (let slot = 0; slot < leaf.markers.length; slot++) {
        result.push(leaf.markers[slot]!);
      }
    });
    return result;
  }

  private assertAllocatedNode(node: PackedEulerNodeHandle): void {
    if (!Number.isInteger(node) || node < 0 || node >= this.nextNodeHandle) {
      throw new Error(`Packed Euler node ${node} is unavailable`);
    }
  }

  private assertMarkerRunAvailable(firstMarker: number, count: number): void {
    for (let offset = 0; offset < count; offset++) {
      if (this.leafIdFor(firstMarker + offset) !== 0) {
        throw new Error(
          `Packed Euler marker ${firstMarker + offset} is in use`,
        );
      }
    }
  }

  private requireLocation(marker: number): number {
    const location = this.locations[marker] ?? 0;
    const leafId = Math.floor(location / LOCATION_SLOT_STRIDE);
    const leaf = this.leavesById[leafId];
    const slot = slotForLocation(location);
    if (
      leafId === 0 ||
      leaf === undefined ||
      slot >= leaf.markers.length ||
      leaf.markers[slot] !== marker
    ) {
      throw new Error(`Packed Euler marker ${marker} is unavailable`);
    }
    return location;
  }

  private leafForLocation(location: number): LeafNode {
    const leafId = Math.floor(location / LOCATION_SLOT_STRIDE);
    const leaf = this.leavesById[leafId];
    if (leaf === undefined) {
      throw new Error(`Packed Euler leaf ${leafId} is unavailable`);
    }
    return leaf;
  }

  private leafIdFor(marker: number): number {
    return Math.floor((this.locations[marker] ?? 0) / LOCATION_SLOT_STRIDE);
  }

  private setLocation(marker: number, leaf: LeafNode, slot: number): void {
    this.locations[marker] = leaf.id * LOCATION_SLOT_STRIDE + slot;
  }

  private visitRankBefore(location: number): number {
    const leaf = this.leafForLocation(location);
    const locationSlot = slotForLocation(location);
    let rank = 0;
    for (let slot = 0; slot < locationSlot; slot++) {
      this.structuralOperationCount++;
      rank += markerVisitWeight(leaf.markers[slot]!);
    }

    let current: TreeNode = leaf;
    while (current.parent !== null) {
      this.structuralOperationCount++;
      const parent: InternalNode = current.parent;
      for (let index = 0; index < current.childIndex; index++) {
        this.structuralOperationCount++;
        rank += parent.children[index]?.visitCount ?? 0;
      }
      current = parent;
    }
    return rank;
  }

  private insertRun(
    leaf: LeafNode,
    slot: number,
    firstMarker: number,
    count: number,
  ): void {
    if (slot < 0 || slot > leaf.markers.length) {
      throw new Error(`Packed Euler leaf slot ${slot} is out of bounds`);
    }
    if (count <= 0 || count > MAX_INSERT_RUN) {
      throw new Error(`Packed Euler marker run length ${count} is invalid`);
    }
    this.structuralOperationCount++;
    if (count === 3) {
      leaf.markers.splice(
        slot,
        0,
        firstMarker,
        firstMarker + 1,
        firstMarker + 2,
      );
    } else if (count === 2) {
      leaf.markers.splice(slot, 0, firstMarker, firstMarker + 1);
    } else {
      leaf.markers.splice(slot, 0, firstMarker);
    }
    let visitDelta = 0;
    for (let offset = 0; offset < count; offset++) {
      const marker = firstMarker + offset;
      visitDelta += markerVisitWeight(marker);
    }

    // Every marker at or after the insertion point either arrived or shifted.
    // Updating a bounded leaf suffix keeps stable handles exact after each
    // mutation without allocating per-marker location objects.
    for (let index = slot; index < leaf.markers.length; index++) {
      this.structuralOperationCount++;
      this.setLocation(leaf.markers[index]!, leaf, index);
    }
    this.propagateVisitDelta(leaf, visitDelta);

    if (leaf.markers.length > LEAF_CAPACITY) {
      this.splitLeaf(leaf);
    }
  }

  private propagateVisitDelta(start: TreeNode, delta: number): void {
    let current: TreeNode | null = start;
    while (current !== null) {
      this.structuralOperationCount++;
      current.visitCount += delta;
      current = current.parent;
    }
  }

  private splitLeaf(leaf: LeafNode): void {
    this.structuralOperationCount++;
    const oldLength = leaf.markers.length;
    const midpoint = Math.ceil(oldLength / 2);
    const sibling = this.createLeaf();
    const movedLength = oldLength - midpoint;

    let movedVisitCount = 0;
    for (let offset = 0; offset < movedLength; offset++) {
      this.structuralOperationCount++;
      const marker = leaf.markers[midpoint + offset]!;
      sibling.markers.push(marker);
      movedVisitCount += markerVisitWeight(marker);
      this.setLocation(marker, sibling, offset);
    }
    leaf.markers.length = midpoint;
    leaf.visitCount -= movedVisitCount;
    sibling.visitCount = movedVisitCount;
    this.insertSiblingAfter(leaf, sibling);
  }

  private splitInternal(node: InternalNode): void {
    this.structuralOperationCount++;
    const midpoint = Math.ceil(node.children.length / 2);
    const movedChildren = node.children.splice(midpoint);
    const sibling = createInternalNode(movedChildren);
    node.visitCount -= sibling.visitCount;
    this.insertSiblingAfter(node, sibling);
  }

  private insertSiblingAfter(node: TreeNode, sibling: TreeNode): void {
    const parent = node.parent;
    if (parent === null) {
      this.root = createInternalNode([node, sibling]);
      return;
    }

    this.structuralOperationCount++;
    const insertionIndex = node.childIndex + 1;
    parent.children.splice(insertionIndex, 0, sibling);
    sibling.parent = parent;
    for (let index = insertionIndex; index < parent.children.length; index++) {
      this.structuralOperationCount++;
      parent.children[index]!.childIndex = index;
    }

    // The sibling contains weight moved out of `node`; parent totals do not
    // change. Cascading internal splits preserve that same invariant.
    if (parent.children.length > BRANCH_FACTOR) {
      this.splitInternal(parent);
    }
  }

  private createLeaf(): LeafNode {
    const id = this.nextLeafId++;
    if (id > MAX_MARKER_ID) {
      throw new Error("Packed Euler leaf capacity exceeded");
    }
    const leaf: LeafNode = {
      kind: "leaf",
      id,
      markers: [],
      parent: null,
      childIndex: 0,
      visitCount: 0,
    };
    this.leavesById[id] = leaf;
    return leaf;
  }

  private visitLeaves(node: TreeNode, visit: (leaf: LeafNode) => void): void {
    if (node.kind === "leaf") {
      visit(node);
      return;
    }
    for (const child of node.children) {
      this.visitLeaves(child, visit);
    }
  }
}

const createInternalNode = (children: TreeNode[]): InternalNode => {
  let visitCount = 0;
  const node: InternalNode = {
    kind: "internal",
    children,
    parent: null,
    childIndex: 0,
    visitCount: 0,
  };
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    child.parent = node;
    child.childIndex = index;
    visitCount += child.visitCount;
  }
  node.visitCount = visitCount;
  return node;
};

const markerId = (
  node: PackedEulerNodeHandle,
  boundary: PackedEulerBoundary,
): number => node * MARKERS_PER_NODE + boundary;

const markerVisitWeight = (marker: number): number =>
  marker !== PACKED_EULER_BOUNDARY.Visit &&
  marker % MARKERS_PER_NODE === PACKED_EULER_BOUNDARY.Visit
    ? 1
    : 0;

const slotForLocation = (location: number): number =>
  location % LOCATION_SLOT_STRIDE;
