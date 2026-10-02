import type { OrderMaintenanceItem } from "./order-maintenance-list";

export const LEAF_CAPACITY = 32;
export const BRANCH_FACTOR = 32;

/**
 * Weights a leaf stores per item, interleaved in {@link LeafNode.weights}:
 * prepare at `offset * WEIGHT_STRIDE + PREPARE_WEIGHT`, then effect, then
 * anchor.
 */
export const WEIGHT_STRIDE = 3;
export const PREPARE_WEIGHT = 0;
export const EFFECT_WEIGHT = 1;
export const ANCHOR_WEIGHT = 2;

export type IndexedNode<T extends object> = LeafNode<T> | InternalNode<T>;

/**
 * One tree built by an {@link IndexedSequence}. Clearing the sequence retires
 * its tree, so an item whose leaf names a retired tree is no longer held by
 * any sequence.
 */
export interface SequenceTree {
  live: boolean;
}

/**
 * Where an {@link IndexedSequence} keeps an item's location: on the item, in
 * place of a side table keyed by it.
 *
 * Only the sequence that holds the item reads or writes the field, so an
 * item belongs to at most one live sequence at a time. Items start with
 * `sequenceLeaf: null`.
 */
export interface IndexedSequenceItem<T extends object> {
  /** Leaf of the sequence that holds the item, or `null`. */
  sequenceLeaf: LeafNode<T> | null;
}

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
  readonly tree: SequenceTree;
  readonly items: T[];
  /** {@link WEIGHT_STRIDE} cached weights per item, in item order. */
  readonly weights: number[];
}

export interface InternalNode<T extends object> extends NodeBase<T> {
  readonly kind: "internal";
  readonly children: IndexedNode<T>[];
}

export const createLeaf = <T extends object>(
  tree: SequenceTree,
  items: T[] = [],
  weights: number[] = [],
): LeafNode<T> => ({
  kind: "leaf",
  parent: null,
  childIndex: 0,
  tree,
  items,
  weights,
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
