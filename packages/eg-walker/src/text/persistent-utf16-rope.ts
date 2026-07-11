export const UTF16_ROPE_TARGET_LEAF = 2_048;
export const UTF16_ROPE_MIN_LEAF = 1_024;
export const UTF16_ROPE_MAX_LEAF = 4_096;
export const UTF16_ROPE_BRANCH_FACTOR = 32;

interface LeafNode {
  readonly kind: "leaf";
  readonly text: string;
  readonly length: number;
  readonly nodeCount: 1;
  readonly height: 0;
}

interface BranchNode {
  readonly kind: "branch";
  readonly children: ReadonlyArray<RopeNode>;
  readonly cumulativeEnds: ReadonlyArray<number>;
  readonly length: number;
  readonly nodeCount: number;
  readonly height: number;
}

type RopeNode = LeafNode | BranchNode;

interface DeleteResult {
  readonly node: RopeNode | null;
  readonly hasUnderfilledLeaf: boolean;
}

export interface Utf16RopeInstrumentation {
  readonly nodeVisits: number;
  readonly nodeAllocations: number;
  readonly splits: number;
  readonly joins: number;
  readonly flattenCount: number;
  readonly flattenedCodeUnits: number;
}

const counters = {
  nodeVisits: 0,
  nodeAllocations: 0,
  splits: 0,
  joins: 0,
  flattenCount: 0,
  flattenedCodeUnits: 0,
};

const leaf = (text: string): LeafNode => {
  counters.nodeAllocations++;
  return Object.freeze({
    kind: "leaf" as const,
    text,
    length: text.length,
    nodeCount: 1 as const,
    height: 0 as const,
  });
};

const EMPTY_LEAF = leaf("");

const branch = (
  children: ReadonlyArray<RopeNode>,
  collapseSingle: boolean = true,
): RopeNode => {
  if (children.length === 0) {
    return EMPTY_LEAF;
  }
  if (collapseSingle && children.length === 1) {
    return children[0]!;
  }
  counters.nodeAllocations++;
  let length = 0;
  let nodeCount = 1;
  const cumulativeEnds = children.map((child) => {
    length += child.length;
    nodeCount += child.nodeCount;
    return length;
  });
  return Object.freeze({
    kind: "branch" as const,
    children: Object.freeze([...children]),
    cumulativeEnds: Object.freeze(cumulativeEnds),
    length,
    nodeCount,
    height: children[0]!.height + 1,
  });
};

/**
 * Immutable UTF-16 rope. Leaves are persistent and branch fan-out is capped
 * at 32; edits rebuild only the shallow branch spine and seam leaves while
 * retaining every untouched leaf by identity.
 */
export class PersistentUtf16Rope {
  private constructor(private readonly root: RopeNode) {}

  static from(text: string): PersistentUtf16Rope {
    return text.length === 0
      ? new PersistentUtf16Rope(EMPTY_LEAF)
      : new PersistentUtf16Rope(buildTree(chunkText(text)));
  }

  static resetInstrumentation(): void {
    counters.nodeVisits = 0;
    counters.nodeAllocations = 0;
    counters.splits = 0;
    counters.joins = 0;
    counters.flattenCount = 0;
    counters.flattenedCodeUnits = 0;
  }

  static getInstrumentation(): Utf16RopeInstrumentation {
    return { ...counters };
  }

  get length(): number {
    return this.root.length;
  }

  get nodeCount(): number {
    return this.root.nodeCount;
  }

  get height(): number {
    return this.root.height;
  }

  insert(index: number, text: string): PersistentUtf16Rope {
    assertIndex(index, this.length, true);
    if (text.length === 0) {
      return this;
    }
    counters.joins++;
    const replacements = insertIntoNode(this.root, index, text);
    return new PersistentUtf16Rope(buildFromSameHeightNodes(replacements));
  }

  delete(index: number, length: number): PersistentUtf16Rope {
    assertRange(index, length, this.length);
    if (length === 0) {
      return this;
    }
    counters.splits += 2;
    if (length === this.length) {
      return new PersistentUtf16Rope(EMPTY_LEAF);
    }
    const deleted = deleteFromNode(this.root, index, index + length);
    const next = collapseRoot(deleted.node ?? EMPTY_LEAF);
    if (!deleted.hasUnderfilledLeaf || next.kind === "leaf") {
      return new PersistentUtf16Rope(next);
    }
    let rebalanced = rebalanceLeafContaining(
      next,
      Math.min(index, next.length - 1),
    );
    if (index > 0) {
      rebalanced = rebalanceLeafContaining(
        rebalanced,
        Math.min(index - 1, rebalanced.length - 1),
      );
    }
    return new PersistentUtf16Rope(rebalanced);
  }

  slice(start: number, end: number = this.length): string {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.length
    ) {
      throw new Error(
        `Invalid rope slice [${start}, ${end}) for length ${this.length}`,
      );
    }
    if (start === end) {
      return "";
    }
    const parts: string[] = [];
    collectSlice(this.root, start, end, 0, parts);
    return parts.join("");
  }

  codeUnitAt(index: number): number | undefined {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) {
      return undefined;
    }
    let node = this.root;
    let offset = index;
    while (node.kind === "branch") {
      counters.nodeVisits++;
      const childIndex = lowerBound(node.cumulativeEnds, offset + 1);
      const previousEnd =
        childIndex === 0 ? 0 : node.cumulativeEnds[childIndex - 1]!;
      offset -= previousEnd;
      node = node.children[childIndex]!;
    }
    counters.nodeVisits++;
    return node.text.charCodeAt(offset);
  }

  toString(): string {
    counters.flattenCount++;
    counters.flattenedCodeUnits += this.length;
    if (this.root.kind === "leaf") {
      return this.root.text;
    }
    return collectLeaves(this.root)
      .map((candidate) => candidate.text)
      .join("");
  }

  /** Add identity-unique leaf payload bytes to a shared accounting set. */
  collectUniqueLeafBytes(seen: Set<object>): number {
    let bytes = 0;
    for (const candidate of collectLeaves(this.root)) {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        bytes += candidate.length * 2;
      }
    }
    return bytes;
  }

  /** Test/diagnostic hook for verifying structural sharing. */
  getLeafIdentities(): ReadonlyArray<object> {
    return collectLeaves(this.root);
  }

  getLeafLengths(): ReadonlyArray<number> {
    return collectLeaves(this.root).map((candidate) => candidate.length);
  }

  getMaxBranchWidth(): number {
    let max = 0;
    const stack: RopeNode[] = [this.root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.kind === "leaf") {
        continue;
      }
      max = Math.max(max, node.children.length);
      stack.push(...node.children);
    }
    return max;
  }
}

const chunkText = (text: string): LeafNode[] => {
  if (text.length === 0) {
    return [];
  }
  const count = Math.max(1, Math.ceil(text.length / UTF16_ROPE_TARGET_LEAF));
  const base = Math.floor(text.length / count);
  const extra = text.length % count;
  const result: LeafNode[] = [];
  let offset = 0;
  for (let index = 0; index < count; index++) {
    const size = base + (index < extra ? 1 : 0);
    result.push(leaf(text.slice(offset, offset + size)));
    offset += size;
  }
  return result;
};

const insertIntoNode = (
  node: RopeNode,
  index: number,
  text: string,
): RopeNode[] => {
  counters.nodeVisits++;
  if (node.kind === "leaf") {
    return chunkText(
      `${node.text.slice(0, index)}${text}${node.text.slice(index)}`,
    );
  }

  const childIndex =
    index === node.length
      ? node.children.length - 1
      : lowerBound(node.cumulativeEnds, index + 1);
  const childStart =
    childIndex === 0 ? 0 : node.cumulativeEnds[childIndex - 1]!;
  const replacements = insertIntoNode(
    node.children[childIndex]!,
    index - childStart,
    text,
  );
  const children = [
    ...node.children.slice(0, childIndex),
    ...replacements,
    ...node.children.slice(childIndex + 1),
  ];
  return partitionLevel(children).map((group) => branch(group, false));
};

const deleteFromNode = (
  node: RopeNode,
  start: number,
  end: number,
): DeleteResult => {
  counters.nodeVisits++;
  if (start <= 0 && end >= node.length) {
    return { node: null, hasUnderfilledLeaf: false };
  }
  if (node.kind === "leaf") {
    const remaining = `${node.text.slice(0, Math.max(0, start))}${node.text.slice(Math.min(node.length, end))}`;
    return {
      node: remaining.length === 0 ? null : leaf(remaining),
      hasUnderfilledLeaf:
        remaining.length > 0 && remaining.length < UTF16_ROPE_MIN_LEAF,
    };
  }

  const children: RopeNode[] = [];
  let hasUnderfilledLeaf = false;
  let childStart = 0;
  for (const child of node.children) {
    const childEnd = childStart + child.length;
    if (end <= childStart || start >= childEnd) {
      children.push(child);
    } else if (!(start <= childStart && end >= childEnd)) {
      const retained = deleteFromNode(
        child,
        Math.max(0, start - childStart),
        Math.min(child.length, end - childStart),
      );
      hasUnderfilledLeaf ||= retained.hasUnderfilledLeaf;
      if (retained.node !== null) {
        children.push(retained.node);
      }
    }
    childStart = childEnd;
  }
  return {
    node: children.length === 0 ? null : branch(children, false),
    hasUnderfilledLeaf,
  };
};

const rebalanceLeafContaining = (root: RopeNode, index: number): RopeNode => {
  if (root.kind === "leaf" || index < 0 || index >= root.length) {
    return root;
  }
  const target = locateLeaf(root, index);
  if (target.leaf.length >= UTF16_ROPE_MIN_LEAF) {
    return root;
  }

  const targetEnd = target.start + target.leaf.length;
  const left =
    targetEnd < root.length ? target : locateLeaf(root, target.start - 1);
  const right = targetEnd < root.length ? locateLeaf(root, targetEnd) : target;
  const rangeStart = left.start;
  const rangeEnd = right.start + right.leaf.length;
  const combined = `${left.leaf.text}${right.leaf.text}`;
  const removed = collapseRoot(
    deleteFromNode(root, rangeStart, rangeEnd).node ?? EMPTY_LEAF,
  );
  const replacements = insertIntoNode(removed, rangeStart, combined);
  return buildFromSameHeightNodes(replacements);
};

const locateLeaf = (
  root: RopeNode,
  index: number,
): { readonly leaf: LeafNode; readonly start: number } => {
  let node = root;
  let offset = index;
  let start = 0;
  while (node.kind === "branch") {
    counters.nodeVisits++;
    const childIndex = lowerBound(node.cumulativeEnds, offset + 1);
    const previousEnd =
      childIndex === 0 ? 0 : node.cumulativeEnds[childIndex - 1]!;
    start += previousEnd;
    offset -= previousEnd;
    node = node.children[childIndex]!;
  }
  counters.nodeVisits++;
  return { leaf: node, start };
};

const partitionLevel = (
  nodes: ReadonlyArray<RopeNode>,
): ReadonlyArray<ReadonlyArray<RopeNode>> => {
  const groupCount = Math.max(
    1,
    Math.ceil(nodes.length / UTF16_ROPE_BRANCH_FACTOR),
  );
  const baseSize = Math.floor(nodes.length / groupCount);
  const extra = nodes.length % groupCount;
  const groups: RopeNode[][] = [];
  let offset = 0;
  for (let group = 0; group < groupCount; group++) {
    const size = baseSize + (group < extra ? 1 : 0);
    groups.push(nodes.slice(offset, offset + size));
    offset += size;
  }
  return groups;
};

const buildFromSameHeightNodes = (nodes: ReadonlyArray<RopeNode>): RopeNode => {
  let level = [...nodes];
  while (level.length > 1) {
    level = partitionLevel(level).map((group) => branch(group, false));
  }
  return collapseRoot(level[0] ?? EMPTY_LEAF);
};

const collapseRoot = (node: RopeNode): RopeNode => {
  let root = node;
  while (root.kind === "branch" && root.children.length === 1) {
    root = root.children[0]!;
  }
  return root;
};

const buildTree = (leaves: ReadonlyArray<LeafNode>): RopeNode => {
  if (leaves.length === 0) {
    return EMPTY_LEAF;
  }
  let level: RopeNode[] = [...leaves];
  while (level.length > 1) {
    const groupCount = Math.ceil(level.length / UTF16_ROPE_BRANCH_FACTOR);
    const baseSize = Math.floor(level.length / groupCount);
    const extra = level.length % groupCount;
    const next: RopeNode[] = [];
    let offset = 0;
    for (let group = 0; group < groupCount; group++) {
      const size = baseSize + (group < extra ? 1 : 0);
      next.push(branch(level.slice(offset, offset + size)));
      offset += size;
    }
    level = next;
  }
  return level[0]!;
};

const collectLeaves = (root: RopeNode): LeafNode[] => {
  const leaves: LeafNode[] = [];
  const stack: RopeNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    counters.nodeVisits++;
    if (node.kind === "leaf") {
      if (node.length > 0) {
        leaves.push(node);
      }
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index--) {
      stack.push(node.children[index]!);
    }
  }
  return leaves;
};

const collectSlice = (
  node: RopeNode,
  start: number,
  end: number,
  nodeStart: number,
  output: string[],
): void => {
  counters.nodeVisits++;
  const nodeEnd = nodeStart + node.length;
  if (end <= nodeStart || start >= nodeEnd) {
    return;
  }
  if (node.kind === "leaf") {
    output.push(
      node.text.slice(
        Math.max(0, start - nodeStart),
        Math.min(node.length, end - nodeStart),
      ),
    );
    return;
  }
  let childStart = nodeStart;
  for (const child of node.children) {
    collectSlice(child, start, end, childStart, output);
    childStart += child.length;
    if (childStart >= end) {
      break;
    }
  }
};

const lowerBound = (values: ReadonlyArray<number>, target: number): number => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((values[middle] ?? 0) < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const assertIndex = (
  index: number,
  length: number,
  allowEnd: boolean,
): void => {
  const max = allowEnd ? length : length - 1;
  if (!Number.isSafeInteger(index) || index < 0 || index > max) {
    throw new Error(`Invalid rope index ${index} for length ${length}`);
  }
};

const assertRange = (index: number, length: number, total: number): void => {
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(length) ||
    index < 0 ||
    length < 0 ||
    index + length > total
  ) {
    throw new Error(
      `Invalid rope delete range [${index}, ${index + length}) for length ${total}`,
    );
  }
};
