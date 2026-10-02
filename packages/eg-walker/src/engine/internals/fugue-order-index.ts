import {
  compareEventIdSortKeys,
  createEventIdSortKey,
  type EventIdSortKey,
} from "../../graph/event-id";
import type { EventId } from "../../types";
import type { IndexedSequence } from "../indexed-sequence";
import {
  PLACEHOLDER_AGENT,
  type AugmentedCRDTItem,
  type ItemKey,
} from "./engine-types";
import {
  PACKED_EULER_BOUNDARY,
  PackedEulerRankIndex,
  type PackedEulerBoundary,
  type PackedEulerNodeHandle,
} from "./packed-euler-rank-index";

type Side = "left" | "right";

interface FugueNode {
  readonly item: AugmentedCRDTItem | null;
  sortKey: EventIdSortKey | null;
  readonly markerHandle: PackedEulerNodeHandle;
  leftSiblings: SiblingNode | null;
  rightSiblings: SiblingNode | null;
}

interface SiblingNode {
  readonly value: FugueNode;
  left: SiblingNode | null;
  right: SiblingNode | null;
  height: number;
}

export interface FugueOrderStats {
  readonly comparisons: number;
  readonly markerOperations: number;
  readonly markerTreeOperations: number;
  readonly rotations: number;
  readonly rebuilds: number;
}

/**
 * Double-sided Fugue tree backed by deterministic AVL sibling indexes and a
 * ranked Euler-marker sequence. START/VISIT/END markers make a sibling
 * subtree's insertion boundary and visible sequence rank available in
 * worst-case logarithmic time, independent of caller-controlled event IDs.
 *
 * A cleared index is unbuilt: it holds no record and ignores records placed
 * at known positions and record splits, so an engine pays nothing for it
 * until a conflict needs it. The first {@link integrate} builds it from the
 * sequence; from then on it holds every record.
 */
export class FugueOrderIndex {
  private readonly markerSequence = new PackedEulerRankIndex();
  /** Fugue node of each item, indexed by item key. */
  private nodesById: Array<FugueNode | undefined> = [];
  private readonly forcedParentById = new Map<ItemKey, ItemKey>();
  private readonly forcedChildByParentId = new Map<ItemKey, ItemKey>();
  private rootNode!: FugueNode;
  private comparisons = 0;
  private markerOperations = 0;
  private markerTreeOperationOffset = 0;
  private rotations = 0;
  private rebuilds = 0;
  /** Whether the index holds every record of the sequence, in its order. */
  private built = false;

  /**
   * @param itemAt resolves an item key.
   * @param eventIdOf formats the ID of an item's event. Siblings with equal
   * anchors are ordered by event ID; the ID is formatted only at such a tie.
   */
  constructor(
    private readonly sequence: IndexedSequence<AugmentedCRDTItem>,
    private readonly itemAt: (itemId: ItemKey) => AugmentedCRDTItem | undefined,
    private readonly eventIdOf: (item: AugmentedCRDTItem) => EventId,
  ) {
    this.reset();
  }

  /**
   * Drop every record. With `maintain`, the empty index is built and keeps
   * every record from now on; otherwise it stays unbuilt until the next
   * {@link integrate}.
   */
  clear(maintain: boolean = false): void {
    this.reset();
    this.built = maintain;
  }

  /** Whether the index holds every record of the sequence. */
  get isBuilt(): boolean {
    return this.built;
  }

  getStats(): FugueOrderStats {
    return {
      comparisons: this.comparisons,
      markerOperations: this.markerOperations,
      markerTreeOperations:
        this.markerTreeOperationOffset +
        this.markerSequence.getStructuralOperationCount(),
      rotations: this.rotations,
      rebuilds: this.rebuilds,
    };
  }

  restoreStats(stats: FugueOrderStats): void {
    this.comparisons = stats.comparisons;
    this.markerOperations = stats.markerOperations;
    this.markerTreeOperationOffset = stats.markerTreeOperations;
    this.markerSequence.restoreStructuralOperationCount(0);
    this.rotations = stats.rotations;
    this.rebuilds = stats.rebuilds;
  }

  /**
   * Insert and return the record position of the new item's VISIT marker.
   *
   * An unbuilt index first builds itself from the sequence, which must not
   * hold `item` yet. Returns `null` when the built tree does not reproduce
   * the sequence order.
   */
  integrate(item: AugmentedCRDTItem): number | null {
    if (!this.built) {
      this.rebuild(this.sequence.toArray());
      if (!this.built) {
        return null;
      }
    }
    return this.integrateInternal(item, true);
  }

  /**
   * Insert when the caller has already proved the document position. An
   * unbuilt index ignores the item: building it reads the item from the
   * sequence.
   */
  integrateAtKnownPosition(item: AugmentedCRDTItem): void {
    if (this.built) {
      this.integrateInternal(item, false);
    }
  }

  private integrateInternal(
    item: AugmentedCRDTItem,
    collectPosition: boolean,
  ): number {
    const forcedParentId = this.forcedParentById.get(item.id);
    const rightAnchor =
      item.originRight === null ? null : this.itemAt(item.originRight);
    const isLeftChild =
      forcedParentId === undefined &&
      rightAnchor !== undefined &&
      rightAnchor !== null &&
      rightAnchor.originLeft === item.originLeft;
    const parent =
      forcedParentId !== undefined
        ? this.nodesById[forcedParentId]
        : isLeftChild
          ? this.nodesById[rightAnchor.id]
          : item.originLeft === null
            ? this.rootNode
            : this.nodesById[item.originLeft];
    if (parent === undefined) {
      throw new Error(
        `Fugue index missing parent ${item.originLeft ?? "ROOT"} for ${item.id}`,
      );
    }
    const side: Side = isLeftChild ? "left" : "right";
    const node = createFugueNode(item, this.markerSequence.allocateNode());
    const insertion = this.insertSibling(
      side === "left" ? parent.leftSiblings : parent.rightSiblings,
      node,
      side,
    );
    if (side === "left") {
      parent.leftSiblings = insertion.root;
    } else {
      parent.rightSiblings = insertion.root;
    }

    const target = insertion.successor ?? parent;
    const targetBoundary: PackedEulerBoundary =
      insertion.successor !== null
        ? PACKED_EULER_BOUNDARY.Start
        : side === "left"
          ? PACKED_EULER_BOUNDARY.Visit
          : PACKED_EULER_BOUNDARY.End;
    let position = 0;
    if (collectPosition) {
      position = this.markerSequence.insertNodeBefore(
        target.markerHandle,
        targetBoundary,
        node.markerHandle,
      );
    } else {
      this.markerSequence.insertNodeBeforeUnranked(
        target.markerHandle,
        targetBoundary,
        node.markerHandle,
      );
    }
    this.markerOperations += 3;
    this.nodesById[item.id] = node;
    return position;
  }

  /**
   * Build the index from `records`, the sequence's records in order. The
   * index is built afterwards only if the tree reproduces that order.
   */
  rebuild(records: ReadonlyArray<AugmentedCRDTItem>): void {
    this.rebuilds++;
    this.forcedParentById.clear();
    this.forcedChildByParentId.clear();
    let previousPlaceholderId: ItemKey | null = null;
    for (const item of records) {
      if (item.agent !== PLACEHOLDER_AGENT) {
        continue;
      }
      if (previousPlaceholderId !== null) {
        this.setForcedParent(item.id, previousPlaceholderId);
      }
      previousPlaceholderId = item.id;
    }
    this.reset(false);
    this.built = false;
    const recordIds = new Set(records.map(({ id }) => id));
    const childrenByParent = new Map<ItemKey | null, AugmentedCRDTItem[]>();
    for (const item of records) {
      const parentId = this.fugueParentId(item);
      if (parentId !== null && !recordIds.has(parentId)) {
        return;
      }
      const children = childrenByParent.get(parentId) ?? [];
      children.push(item);
      childrenByParent.set(parentId, children);
    }

    // Parents go in before their children. No insert needs its rank: the
    // loop below checks every rank once all records are in.
    const queue = [...(childrenByParent.get(null) ?? [])];
    for (let index = 0; index < queue.length; index++) {
      const item = queue[index]!;
      this.integrateInternal(item, false);
      for (const child of childrenByParent.get(item.id) ?? []) {
        queue.push(child);
      }
    }
    if (queue.length !== records.length) {
      return;
    }

    for (let index = 0; index < records.length; index++) {
      const node = this.nodesById[records[index]!.id];
      if (
        node === undefined ||
        this.markerSequence.rankOfVisit(node.markerHandle) !== index
      ) {
        return;
      }
    }
    this.built = true;
  }

  /**
   * Register the right half of a split record. An unbuilt index ignores the
   * split: building it reads both halves from the sequence.
   */
  handleRecordSplit(left: AugmentedCRDTItem, right: AugmentedCRDTItem): void {
    if (!this.built) {
      return;
    }
    const leftNode = this.nodesById[left.id];
    if (leftNode === undefined) {
      throw new Error(`Fugue index missing split record ${left.id}`);
    }
    if (this.nodesById[right.id] !== undefined) {
      throw new Error(`Fugue index already contains split record ${right.id}`);
    }
    if (!this.sequence.areAdjacent(left, right)) {
      throw new Error(`Fugue split position mismatch for ${right.id}`);
    }

    const rightNode = createFugueNode(
      right,
      this.markerSequence.allocateNode(),
    );
    rightNode.rightSiblings = leftNode.rightSiblings;
    leftNode.rightSiblings = createSiblingNode(rightNode);

    const previousForcedChild = this.forcedChildByParentId.get(left.id);
    if (previousForcedChild !== undefined) {
      this.forcedChildByParentId.delete(left.id);
      this.forcedParentById.set(previousForcedChild, right.id);
      this.forcedChildByParentId.set(right.id, previousForcedChild);
    }
    if (right.agent === PLACEHOLDER_AGENT) {
      this.setForcedParent(right.id, left.id);
    }

    this.markerSequence.insertSplitContinuation(
      leftNode.markerHandle,
      rightNode.markerHandle,
    );
    this.markerOperations += 3;
    this.nodesById[right.id] = rightNode;
  }

  /** Drop the index; the next {@link integrate} builds it again. */
  invalidate(): void {
    this.built = false;
  }

  private fugueParentId(item: AugmentedCRDTItem): ItemKey | null {
    const forcedParent = this.forcedParentById.get(item.id);
    if (forcedParent !== undefined) {
      return forcedParent;
    }
    const rightAnchor =
      item.originRight === null ? null : this.itemAt(item.originRight);
    return rightAnchor !== undefined &&
      rightAnchor !== null &&
      rightAnchor.originLeft === item.originLeft
      ? rightAnchor.id
      : item.originLeft;
  }

  private reset(resetStats: boolean = true): void {
    if (resetStats) {
      this.markerTreeOperationOffset = 0;
    } else {
      this.markerTreeOperationOffset +=
        this.markerSequence.getStructuralOperationCount();
    }
    this.nodesById = [];
    const root = createFugueNode(null, this.markerSequence.reset());
    this.rootNode = root;
    if (resetStats) {
      this.forcedParentById.clear();
      this.forcedChildByParentId.clear();
      this.comparisons = 0;
      this.markerOperations = 0;
      this.rotations = 0;
      this.rebuilds = 0;
    }
  }

  private insertSibling(
    root: SiblingNode | null,
    value: FugueNode,
    side: Side,
  ): { readonly root: SiblingNode; readonly successor: FugueNode | null } {
    let successor: FugueNode | null = null;
    const node = createSiblingNode(value);
    const insert = (current: SiblingNode | null): SiblingNode => {
      if (current === null) {
        return node;
      }
      const comparison = this.compareSiblings(value, current.value, side);
      if (comparison < 0) {
        successor = current.value;
        current.left = insert(current.left);
      } else {
        current.right = insert(current.right);
      }
      return this.rebalanceSibling(current);
    };
    return { root: insert(root), successor };
  }

  private rebalanceSibling(root: SiblingNode): SiblingNode {
    updateSiblingHeight(root);
    const balance = siblingBalance(root);
    if (balance > 1) {
      if (siblingBalance(root.left!) < 0) {
        root.left = rotateSiblingLeft(root.left!);
        this.rotations++;
      }
      this.rotations++;
      return rotateSiblingRight(root);
    }
    if (balance < -1) {
      if (siblingBalance(root.right!) > 0) {
        root.right = rotateSiblingRight(root.right!);
        this.rotations++;
      }
      this.rotations++;
      return rotateSiblingLeft(root);
    }
    return root;
  }

  private compareSiblings(
    left: FugueNode,
    right: FugueNode,
    side: Side,
  ): number {
    this.comparisons++;
    if (side === "right") {
      const leftPlaceholder = left.item!.agent === PLACEHOLDER_AGENT;
      const rightPlaceholder = right.item!.agent === PLACEHOLDER_AGENT;
      if (leftPlaceholder !== rightPlaceholder) {
        // A split placeholder is the untouched suffix of checkpoint/initial
        // text. New children anchored at the split boundary belong before
        // that suffix, so the continuation sorts last in the right region.
        return leftPlaceholder ? 1 : -1;
      }
      const anchorComparison = this.compareRightAnchors(
        left.item!.originRight,
        right.item!.originRight,
      );
      if (anchorComparison !== 0) {
        return anchorComparison;
      }
    }
    return compareEventIdSortKeys(
      this.getSortKey(left),
      this.getSortKey(right),
    );
  }

  private compareRightAnchors(
    leftId: ItemKey | null,
    rightId: ItemKey | null,
  ): number {
    if (leftId === rightId) {
      return 0;
    }
    if (leftId === null) {
      return -1;
    }
    if (rightId === null) {
      return 1;
    }
    const left = this.nodesById[leftId];
    const right = this.nodesById[rightId];
    if (left === undefined) {
      return right === undefined ? 0 : -1;
    }
    if (right === undefined) {
      return 1;
    }
    // Right anchors sort from the end of the record order toward the start.
    return -this.sequence.compareOrder(left.item!, right.item!);
  }

  private getSortKey(node: FugueNode): EventIdSortKey {
    if (node.sortKey === null) {
      node.sortKey = createEventIdSortKey(this.eventIdOf(node.item!));
    }
    return node.sortKey;
  }

  private setForcedParent(childId: ItemKey, parentId: ItemKey): void {
    const existingChild = this.forcedChildByParentId.get(parentId);
    if (existingChild !== undefined && existingChild !== childId) {
      throw new Error(`Fugue forced parent ${parentId} has multiple children`);
    }
    this.forcedParentById.set(childId, parentId);
    this.forcedChildByParentId.set(parentId, childId);
  }
}

const createSiblingNode = (value: FugueNode): SiblingNode => ({
  value,
  left: null,
  right: null,
  height: 1,
});

const createFugueNode = (
  item: AugmentedCRDTItem | null,
  markerHandle: PackedEulerNodeHandle,
): FugueNode => {
  return {
    item,
    sortKey: null,
    markerHandle,
    leftSiblings: null,
    rightSiblings: null,
  };
};

const rotateSiblingRight = (root: SiblingNode): SiblingNode => {
  const pivot = root.left!;
  root.left = pivot.right;
  pivot.right = root;
  updateSiblingHeight(root);
  updateSiblingHeight(pivot);
  return pivot;
};

const rotateSiblingLeft = (root: SiblingNode): SiblingNode => {
  const pivot = root.right!;
  root.right = pivot.left;
  pivot.left = root;
  updateSiblingHeight(root);
  updateSiblingHeight(pivot);
  return pivot;
};

const siblingHeight = (node: SiblingNode | null): number => node?.height ?? 0;

const siblingBalance = (node: SiblingNode): number =>
  siblingHeight(node.left) - siblingHeight(node.right);

const updateSiblingHeight = (node: SiblingNode): void => {
  node.height =
    1 + Math.max(siblingHeight(node.left), siblingHeight(node.right));
};
