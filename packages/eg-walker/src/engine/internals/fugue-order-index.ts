import { compareEventIds } from "../../graph/event-id";
import type { EventId } from "../../types";
import type { IndexedSequence } from "../indexed-sequence";
import { PLACEHOLDER_EVENT_ID, type AugmentedCRDTItem } from "./engine-types";

type Side = "left" | "right";
type MarkerKind = "start" | "visit" | "end";

interface Marker {
  readonly key: string;
  readonly kind: MarkerKind;
  readonly weight: number;
  readonly priority: number;
  left: Marker | null;
  right: Marker | null;
  parent: Marker | null;
  size: number;
  visitWeight: number;
}

interface FugueNode {
  readonly item: AugmentedCRDTItem | null;
  readonly start: Marker;
  readonly visit: Marker;
  readonly end: Marker;
}

interface SiblingNode {
  readonly value: FugueNode;
  readonly priority: number;
  left: SiblingNode | null;
  right: SiblingNode | null;
}

export interface FugueOrderStats {
  readonly comparisons: number;
  readonly markerOperations: number;
  readonly rotations: number;
  readonly rebuilds: number;
}

/**
 * Double-sided Fugue tree backed by an implicit Euler order-statistic treap.
 * START/VISIT/END markers make a sibling subtree's insertion boundary and
 * visible sequence rank available in logarithmic time.
 */
export class FugueOrderIndex {
  private markerRoot: Marker | null = null;
  private readonly nodesById = new Map<EventId, FugueNode>();
  private readonly siblingRoots = new Map<string, SiblingNode | null>();
  private readonly forcedParentById = new Map<EventId, EventId>();
  private readonly forcedChildByParentId = new Map<EventId, EventId>();
  private rootNode!: FugueNode;
  private comparisons = 0;
  private markerOperations = 0;
  private rotations = 0;
  private rebuilds = 0;
  private valid = true;

  constructor(
    private readonly sequence: IndexedSequence<AugmentedCRDTItem>,
    private readonly itemsById: ReadonlyMap<EventId, AugmentedCRDTItem>,
  ) {
    this.reset();
  }

  clear(): void {
    this.reset();
  }

  getStats(): FugueOrderStats {
    return {
      comparisons: this.comparisons,
      markerOperations: this.markerOperations,
      rotations: this.rotations,
      rebuilds: this.rebuilds,
    };
  }

  restoreStats(stats: FugueOrderStats): void {
    this.comparisons = stats.comparisons;
    this.markerOperations = stats.markerOperations;
    this.rotations = stats.rotations;
    this.rebuilds = stats.rebuilds;
  }

  /** Insert and return the record position of the new item's VISIT marker. */
  integrate(item: AugmentedCRDTItem): number | null {
    // Record splitting rewrites logical boundaries; until those boundary
    // objects are represented directly, let the scalar oracle handle the
    // post-split transition without risking ordering drift. Ordinary anchored
    // siblings are fully represented by the Euler tree and stay indexed.
    if (!this.valid) {
      this.rebuild(this.sequence.toArray());
      if (!this.valid) {
        return null;
      }
    }
    const forcedParentId = this.forcedParentById.get(item.id);
    const rightAnchor =
      item.originRight === null ? null : this.itemsById.get(item.originRight);
    const isLeftChild =
      forcedParentId === undefined &&
      rightAnchor !== undefined &&
      rightAnchor !== null &&
      rightAnchor.originLeft === item.originLeft;
    const parent =
      forcedParentId !== undefined
        ? this.nodesById.get(forcedParentId)
        : isLeftChild
          ? this.nodesById.get(rightAnchor.id)
          : item.originLeft === null
            ? this.rootNode
            : this.nodesById.get(item.originLeft);
    if (parent === undefined) {
      throw new Error(
        `Fugue index missing parent ${item.originLeft ?? "ROOT"} for ${item.id}`,
      );
    }
    const side: Side = isLeftChild ? "left" : "right";
    const node = createFugueNode(item);
    const siblingKey = keyForSiblings(parent, side);
    const insertion = this.insertSibling(
      this.siblingRoots.get(siblingKey) ?? null,
      node,
      side,
    );
    this.siblingRoots.set(siblingKey, insertion.root);

    const target =
      insertion.successor?.start ??
      (side === "left" ? parent.visit : parent.end);
    this.insertMarkersBefore(target, [node.start, node.visit, node.end]);
    this.nodesById.set(item.id, node);
    return weightBefore(node.visit);
  }

  /** Rebuild restored records or repair an explicitly invalidated index. */
  rebuild(records: ReadonlyArray<AugmentedCRDTItem>): void {
    this.rebuilds++;
    this.forcedParentById.clear();
    this.forcedChildByParentId.clear();
    let previousPlaceholderId: EventId | null = null;
    for (const item of records) {
      if (item.eventId !== PLACEHOLDER_EVENT_ID) {
        continue;
      }
      if (previousPlaceholderId !== null) {
        this.setForcedParent(item.id, previousPlaceholderId);
      }
      previousPlaceholderId = item.id;
    }
    this.reset(false);
    this.valid = true;

    const recordIds = new Set(records.map(({ id }) => id));
    const childrenByParent = new Map<EventId | null, AugmentedCRDTItem[]>();
    for (const item of records) {
      const parentId = this.fugueParentId(item);
      if (parentId !== null && !recordIds.has(parentId)) {
        this.valid = false;
        return;
      }
      const children = childrenByParent.get(parentId) ?? [];
      children.push(item);
      childrenByParent.set(parentId, children);
    }

    const queue = [...(childrenByParent.get(null) ?? [])];
    let integrated = 0;
    for (let index = 0; index < queue.length; index++) {
      const item = queue[index]!;
      if (this.integrate(item) === null) {
        this.valid = false;
        return;
      }
      integrated++;
      queue.push(...(childrenByParent.get(item.id) ?? []));
    }
    if (integrated !== records.length) {
      this.valid = false;
      return;
    }

    for (let index = 0; index < records.length; index++) {
      const node = this.nodesById.get(records[index]!.id);
      if (node === undefined || weightBefore(node.visit) !== index) {
        this.valid = false;
        return;
      }
    }
  }

  handleRecordSplit(
    left: AugmentedCRDTItem,
    right: AugmentedCRDTItem,
    rightPosition: number,
  ): void {
    if (!this.valid) {
      throw new Error("Cannot update an invalid Fugue order index");
    }
    const leftNode = this.nodesById.get(left.id);
    if (leftNode === undefined) {
      throw new Error(`Fugue index missing split record ${left.id}`);
    }
    if (this.nodesById.has(right.id)) {
      throw new Error(`Fugue index already contains split record ${right.id}`);
    }
    if (
      weightBefore(leftNode.visit) + 1 !== rightPosition ||
      this.sequence.positionOf(right) !== rightPosition
    ) {
      throw new Error(`Fugue split position mismatch for ${right.id}`);
    }

    const rightNode = createFugueNode(right);
    const leftChildrenKey = keyForSiblings(leftNode, "right");
    const rightChildrenKey = keyForSiblings(rightNode, "right");
    const previousRightChildren =
      this.siblingRoots.get(leftChildrenKey) ?? null;
    this.siblingRoots.set(rightChildrenKey, previousRightChildren);
    this.siblingRoots.set(leftChildrenKey, createSiblingNode(rightNode));

    const previousForcedChild = this.forcedChildByParentId.get(left.id);
    if (previousForcedChild !== undefined) {
      this.forcedChildByParentId.delete(left.id);
      this.forcedParentById.set(previousForcedChild, right.id);
      this.forcedChildByParentId.set(right.id, previousForcedChild);
    }
    if (right.eventId === PLACEHOLDER_EVENT_ID) {
      this.setForcedParent(right.id, left.id);
    }

    this.insertMarkersAt(markerRank(leftNode.visit) + 1, [
      rightNode.start,
      rightNode.visit,
    ]);
    this.insertMarkersBefore(leftNode.end, [rightNode.end]);
    this.nodesById.set(right.id, rightNode);
    if (weightBefore(rightNode.visit) !== rightPosition) {
      throw new Error(`Fugue split rank mismatch for ${right.id}`);
    }
  }

  invalidate(): void {
    this.valid = false;
  }

  private fugueParentId(item: AugmentedCRDTItem): EventId | null {
    const forcedParent = this.forcedParentById.get(item.id);
    if (forcedParent !== undefined) {
      return forcedParent;
    }
    const rightAnchor =
      item.originRight === null ? null : this.itemsById.get(item.originRight);
    return rightAnchor !== undefined &&
      rightAnchor !== null &&
      rightAnchor.originLeft === item.originLeft
      ? rightAnchor.id
      : item.originLeft;
  }

  private reset(resetStats: boolean = true): void {
    this.nodesById.clear();
    this.siblingRoots.clear();
    const root = createFugueNode(null);
    this.rootNode = root;
    this.markerRoot = mergeMarkers(
      mergeMarkers(root.start, root.visit),
      root.end,
    );
    if (resetStats) {
      this.forcedParentById.clear();
      this.forcedChildByParentId.clear();
      this.comparisons = 0;
      this.markerOperations = 0;
      this.rotations = 0;
      this.rebuilds = 0;
      this.valid = true;
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
        if (current.left.priority > current.priority) {
          this.rotations++;
          return rotateSiblingRight(current);
        }
      } else {
        current.right = insert(current.right);
        if (current.right.priority > current.priority) {
          this.rotations++;
          return rotateSiblingLeft(current);
        }
      }
      return current;
    };
    return { root: insert(root), successor };
  }

  private compareSiblings(
    left: FugueNode,
    right: FugueNode,
    side: Side,
  ): number {
    this.comparisons++;
    if (side === "right") {
      const leftPlaceholder = left.item!.eventId === PLACEHOLDER_EVENT_ID;
      const rightPlaceholder = right.item!.eventId === PLACEHOLDER_EVENT_ID;
      if (leftPlaceholder !== rightPlaceholder) {
        // A split placeholder is the untouched suffix of checkpoint/initial
        // text. New children anchored at the split boundary belong before
        // that suffix, so the continuation sorts last in the right region.
        return leftPlaceholder ? 1 : -1;
      }
      const leftRank = this.rightAnchorRank(left.item!.originRight);
      const rightRank = this.rightAnchorRank(right.item!.originRight);
      if (leftRank !== rightRank) {
        return rightRank - leftRank;
      }
    }
    return compareEventIds(left.item!.eventId, right.item!.eventId);
  }

  private rightAnchorRank(eventId: EventId | null): number {
    if (eventId === null) {
      return Number.MAX_SAFE_INTEGER;
    }
    const node = this.nodesById.get(eventId);
    return node === undefined
      ? Number.MAX_SAFE_INTEGER - 1
      : weightBefore(node.visit);
  }

  private insertMarkersBefore(
    target: Marker,
    markers: ReadonlyArray<Marker>,
  ): void {
    this.insertMarkersAt(markerRank(target), markers);
  }

  private insertMarkersAt(rank: number, markers: ReadonlyArray<Marker>): void {
    if (this.markerRoot === null) {
      throw new Error("Fugue marker root is unavailable");
    }
    const [left, right] = splitMarkers(this.markerRoot, rank);
    let block: Marker | null = null;
    for (const marker of markers) {
      block = mergeMarkers(block, marker);
    }
    this.markerRoot = mergeMarkers(mergeMarkers(left, block), right);
    if (this.markerRoot !== null) {
      this.markerRoot.parent = null;
    }
    this.markerOperations += markers.length;
  }

  private setForcedParent(childId: EventId, parentId: EventId): void {
    const existingChild = this.forcedChildByParentId.get(parentId);
    if (existingChild !== undefined && existingChild !== childId) {
      throw new Error(`Fugue forced parent ${parentId} has multiple children`);
    }
    this.forcedParentById.set(childId, parentId);
    this.forcedChildByParentId.set(parentId, childId);
  }
}

const keyForSiblings = (parent: FugueNode, side: Side): string =>
  `${parent.item?.id ?? "ROOT"}:${side}`;

const createSiblingNode = (value: FugueNode): SiblingNode => ({
  value,
  priority: stablePriority(`${value.item!.id}:sibling`),
  left: null,
  right: null,
});

const createFugueNode = (item: AugmentedCRDTItem | null): FugueNode => {
  const id = item?.id ?? "ROOT";
  return {
    item,
    start: createMarker(`${id}:start`, "start", 0),
    visit: createMarker(`${id}:visit`, "visit", item === null ? 0 : 1),
    end: createMarker(`${id}:end`, "end", 0),
  };
};

const createMarker = (
  key: string,
  kind: MarkerKind,
  weight: number,
): Marker => ({
  key,
  kind,
  weight,
  priority: stablePriority(key),
  left: null,
  right: null,
  parent: null,
  size: 1,
  visitWeight: weight,
});

const updateMarker = (node: Marker): void => {
  node.size = 1 + markerSize(node.left) + markerSize(node.right);
  node.visitWeight =
    node.weight + markerWeight(node.left) + markerWeight(node.right);
  if (node.left !== null) node.left.parent = node;
  if (node.right !== null) node.right.parent = node;
};

const mergeMarkers = (
  left: Marker | null,
  right: Marker | null,
): Marker | null => {
  if (left === null) {
    if (right !== null) right.parent = null;
    return right;
  }
  if (right === null) {
    left.parent = null;
    return left;
  }
  if (left.priority >= right.priority) {
    left.right = mergeMarkers(left.right, right);
    updateMarker(left);
    left.parent = null;
    return left;
  }
  right.left = mergeMarkers(left, right.left);
  updateMarker(right);
  right.parent = null;
  return right;
};

const splitMarkers = (
  root: Marker | null,
  leftSize: number,
): readonly [Marker | null, Marker | null] => {
  if (root === null) {
    return [null, null];
  }
  if (markerSize(root.left) >= leftSize) {
    const [left, rightOfLeft] = splitMarkers(root.left, leftSize);
    root.left = rightOfLeft;
    updateMarker(root);
    if (left !== null) left.parent = null;
    root.parent = null;
    return [left, root];
  }
  const [leftOfRight, right] = splitMarkers(
    root.right,
    leftSize - markerSize(root.left) - 1,
  );
  root.right = leftOfRight;
  updateMarker(root);
  root.parent = null;
  if (right !== null) right.parent = null;
  return [root, right];
};

const markerRank = (marker: Marker): number => {
  let rank = markerSize(marker.left);
  let current = marker;
  while (current.parent !== null) {
    if (current === current.parent.right) {
      rank += markerSize(current.parent.left) + 1;
    }
    current = current.parent;
  }
  return rank;
};

const weightBefore = (marker: Marker): number => {
  let weight = markerWeight(marker.left);
  let current = marker;
  while (current.parent !== null) {
    if (current === current.parent.right) {
      weight += markerWeight(current.parent.left) + current.parent.weight;
    }
    current = current.parent;
  }
  return weight;
};

const markerSize = (marker: Marker | null): number => marker?.size ?? 0;
const markerWeight = (marker: Marker | null): number =>
  marker?.visitWeight ?? 0;

const rotateSiblingRight = (root: SiblingNode): SiblingNode => {
  const pivot = root.left!;
  root.left = pivot.right;
  pivot.right = root;
  return pivot;
};

const rotateSiblingLeft = (root: SiblingNode): SiblingNode => {
  const pivot = root.right!;
  root.right = pivot.left;
  pivot.left = root;
  return pivot;
};

const stablePriority = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};
