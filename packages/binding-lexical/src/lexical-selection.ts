import { $isListNode } from "@lexical/list";
import {
  $createRangeSelection,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTabNode,
  $isTextNode,
  $setSelection,
  type ElementNode,
  type LexicalNode,
  type NodeKey,
  type PointType,
} from "lexical";
import type { LexicalBlockIndex } from "./projection-to-lexical";

export interface LogicalSelectionPoint {
  readonly blockId: string;
  readonly offset: number;
}

export interface LogicalSelection {
  readonly anchor: LogicalSelectionPoint;
  readonly focus: LogicalSelectionPoint;
}

interface InlineLeaf {
  readonly key: NodeKey;
  readonly parentKey: NodeKey;
  readonly childIndex: number;
  readonly start: number;
  readonly end: number;
  readonly type: "text" | "linebreak" | "tab";
}

const collectLeaves = (
  node: ElementNode,
  leaves: InlineLeaf[],
  initialOffset = 0,
): number => {
  let offset = initialOffset;
  for (const [childIndex, child] of node.getChildren().entries()) {
    if ($isListNode(child)) continue;
    if ($isTextNode(child)) {
      const end = offset + child.getTextContentSize();
      leaves.push({
        key: child.getKey(),
        parentKey: node.getKey(),
        childIndex,
        start: offset,
        end,
        type: "text",
      });
      offset = end;
      continue;
    }
    if ($isLineBreakNode(child) || $isTabNode(child)) {
      leaves.push({
        key: child.getKey(),
        parentKey: node.getKey(),
        childIndex,
        start: offset,
        end: offset + 1,
        type: $isLineBreakNode(child) ? "linebreak" : "tab",
      });
      offset++;
      continue;
    }
    if ($isElementNode(child)) {
      offset = collectLeaves(child, leaves, offset);
      continue;
    }
    throw new Error(`Unsupported selection leaf ${child.getType()}`);
  }
  return offset;
};

const findBlock = (
  node: LexicalNode,
  index: LexicalBlockIndex,
): { readonly blockId: string; readonly node: ElementNode } | null => {
  let current: LexicalNode | null = node;
  while (current !== null) {
    const blockId = index.nodeKeyToBlockId.get(current.getKey());
    if (blockId !== undefined) {
      if (!$isElementNode(current)) {
        throw new Error(`Mapped block ${blockId} must be an element`);
      }
      return { blockId, node: current };
    }
    current = current.getParent();
  }
  return null;
};

const pointOffset = (block: ElementNode, point: PointType): number | null => {
  const leaves: InlineLeaf[] = [];
  const documentLength = collectLeaves(block, leaves);
  if (point.type === "text") {
    const leaf = leaves.find((candidate) => candidate.key === point.key);
    return leaf === undefined
      ? null
      : Math.min(leaf.end, leaf.start + point.offset);
  }

  const pointNode = $getNodeByKey(point.key);
  if (pointNode === null || !$isElementNode(pointNode)) return null;
  if (pointNode.getKey() === block.getKey()) {
    const child = block.getChildren()[point.offset];
    if (child === undefined) return documentLength;
    const leaf = leaves.find((candidate) => candidate.key === child.getKey());
    if (leaf !== undefined) return leaf.start;
    const descendant = leaves.find((candidate) => {
      let current = $getNodeByKey(candidate.key)?.getParent() ?? null;
      while (current !== null && current.getKey() !== block.getKey()) {
        if (current.getKey() === child.getKey()) return true;
        current = current.getParent();
      }
      return false;
    });
    return descendant?.start ?? documentLength;
  }

  const child = pointNode.getChildren()[point.offset];
  if (child !== undefined) {
    const direct = leaves.find((candidate) => candidate.key === child.getKey());
    if (direct !== undefined) return direct.start;
  }
  const ownedLeaves = leaves.filter((candidate) => {
    let current = $getNodeByKey(candidate.key)?.getParent() ?? null;
    while (current !== null) {
      if (current.getKey() === pointNode.getKey()) return true;
      if (current.getKey() === block.getKey()) return false;
      current = current.getParent();
    }
    return false;
  });
  return ownedLeaves.at(-1)?.end ?? null;
};

const logicalPoint = (
  point: PointType,
  index: LexicalBlockIndex,
): LogicalSelectionPoint | null => {
  const node = $getNodeByKey(point.key);
  if (node === null) return null;
  const block = findBlock(node, index);
  if (block === null) return null;
  const offset = pointOffset(block.node, point);
  return offset === null ? null : { blockId: block.blockId, offset };
};

/** Capture the direction-preserving Lexical range in block-local offsets. */
export const captureLogicalSelection = (
  index: LexicalBlockIndex,
): LogicalSelection | null => {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchor = logicalPoint(selection.anchor, index);
  const focus = logicalPoint(selection.focus, index);
  return anchor === null || focus === null ? null : { anchor, focus };
};

const setPointAtOffset = (
  point: PointType,
  block: ElementNode,
  requestedOffset: number,
): void => {
  const leaves: InlineLeaf[] = [];
  const length = collectLeaves(block, leaves);
  const offset = Math.max(0, Math.min(length, requestedOffset));
  const textLeaf = leaves.find(
    (leaf) =>
      leaf.type === "text" && offset >= leaf.start && offset <= leaf.end,
  );
  if (textLeaf !== undefined) {
    point.set(textLeaf.key, offset - textLeaf.start, "text");
    return;
  }

  const next = leaves.find((leaf) => leaf.start >= offset);
  if (next !== undefined) {
    point.set(next.parentKey, next.childIndex, "element");
    return;
  }
  point.set(block.getKey(), block.getChildrenSize(), "element");
};

/** Restore anchor/focus without normalizing backwards selections. */
export const restoreLogicalSelection = (
  selection: LogicalSelection,
  index: LexicalBlockIndex,
): boolean => {
  const anchorKey = index.blockIdToNodeKey.get(selection.anchor.blockId);
  const focusKey = index.blockIdToNodeKey.get(selection.focus.blockId);
  if (anchorKey === undefined || focusKey === undefined) return false;
  const anchorBlock = $getNodeByKey(anchorKey);
  const focusBlock = $getNodeByKey(focusKey);
  if (!$isElementNode(anchorBlock) || !$isElementNode(focusBlock)) return false;

  const currentSelection = $getSelection();
  const range = $createRangeSelection();
  if ($isRangeSelection(currentSelection)) {
    range.format = currentSelection.format;
    range.style = currentSelection.style;
  }
  setPointAtOffset(range.anchor, anchorBlock, selection.anchor.offset);
  setPointAtOffset(range.focus, focusBlock, selection.focus.offset);
  $setSelection(range);
  return true;
};
