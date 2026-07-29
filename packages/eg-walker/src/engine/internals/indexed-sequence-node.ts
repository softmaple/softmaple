import type { OrderMaintenanceItem } from "./order-maintenance-list";

export const LEAF_CAPACITY = 32;
export const BRANCH_FACTOR = 32;

export type IndexedNode<T extends object> = LeafNode<T> | InternalNode<T>;

interface NodeBase<T extends object> {
  parent: InternalNode<T> | null;
  // Cached position within `parent.children`. Kept in sync by every code path
  // that mutates a parent's child list so {@link IndexedSequence} can walk
  // up without scanning siblings linearly. Meaningless when `parent` is
  // `null`; we leave it at 0 in that case.
  childIndex: number;
  size: number;
  prepareSum: number;
  effectSum: number;
  anchorSum: number;
  pendingWeightGeneration: number;
  pendingPrepareDelta: number;
  pendingEffectDelta: number;
  pendingAnchorDelta: number;
}

export interface LeafNode<T extends object>
  extends NodeBase<T>,
    OrderMaintenanceItem {
  readonly kind: "leaf";
  readonly items: T[];
  readonly prepareWeights: number[];
  readonly effectWeights: number[];
  readonly anchorWeights: number[];
}

export interface InternalNode<T extends object> extends NodeBase<T> {
  readonly kind: "internal";
  readonly children: IndexedNode<T>[];
}

export interface ItemLocation<T extends object> {
  leaf: LeafNode<T>;
  // Cached offset of the item within `leaf.items`. Maintained by every splice
  // on `leaf.items` so {@link IndexedSequence.positionOf} and
  // {@link IndexedSequence.updateItem} can skip the O(leaf capacity)
  // `Array.indexOf` scan.
  offsetInLeaf: number;
}

export const createLeaf = <T extends object>(): LeafNode<T> => ({
  kind: "leaf",
  parent: null,
  childIndex: 0,
  items: [],
  prepareWeights: [],
  effectWeights: [],
  anchorWeights: [],
  orderLabel: 0,
  orderPrevious: null,
  orderNext: null,
  orderGeneration: 0,
  size: 0,
  prepareSum: 0,
  effectSum: 0,
  anchorSum: 0,
  pendingWeightGeneration: 0,
  pendingPrepareDelta: 0,
  pendingEffectDelta: 0,
  pendingAnchorDelta: 0,
});

export const createInternal = <T extends object>(
  children: IndexedNode<T>[],
): InternalNode<T> => {
  let size = 0;
  let prepareSum = 0;
  let effectSum = 0;
  let anchorSum = 0;
  for (const child of children) {
    size += child.size;
    prepareSum += child.prepareSum;
    effectSum += child.effectSum;
    anchorSum += child.anchorSum;
  }
  const node: InternalNode<T> = {
    kind: "internal",
    parent: null,
    childIndex: 0,
    children,
    size,
    prepareSum,
    effectSum,
    anchorSum,
    pendingWeightGeneration: 0,
    pendingPrepareDelta: 0,
    pendingEffectDelta: 0,
    pendingAnchorDelta: 0,
  };
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (!child) {
      continue;
    }
    child.parent = node;
    child.childIndex = index;
  }
  return node;
};
