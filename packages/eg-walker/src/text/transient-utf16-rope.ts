import {
  containsUtf16SurrogateCodeUnit,
  PersistentUtf16Rope,
  UTF16_ROPE_MIN_LEAF,
  type Utf16RopeAssembler,
} from "./persistent-utf16-rope";

interface RopePiece {
  readonly kind: "rope";
  readonly rope: PersistentUtf16Rope;
  readonly start: number;
  readonly end: number;
  readonly hasSurrogateCodeUnits: boolean;
}

interface TextPiece {
  readonly kind: "text";
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly hasSurrogateCodeUnits: boolean;
}

type Piece = RopePiece | TextPiece;

class PieceNode {
  left: PieceNode | null = null;
  right: PieceNode | null = null;
  piece: Piece;
  totalLength: number;
  hasSurrogateCodeUnits: boolean;

  constructor(
    piece: Piece,
    readonly priority: number,
  ) {
    this.piece = piece;
    this.totalLength = pieceLength(piece);
    this.hasSurrogateCodeUnits = piece.hasSurrogateCodeUnits;
  }
}

/**
 * Mutable one-shot editor used while replaying a checkpoint-free linear span.
 *
 * The editor stores inserted text and immutable source-rope ranges in an
 * implicit treap. Edits mutate only this temporary index. `finish()` freezes
 * the result into a normal persistent rope, donating long source ranges by
 * leaf identity and compacting short fragments into fresh target-sized leaves.
 */
export class TransientUtf16RopeEditor {
  private root: PieceNode | null;
  private finished: PersistentUtf16Rope | null = null;
  private dirty = false;
  private priorityState = 0x9e3779b9;

  constructor(private readonly base: PersistentUtf16Rope) {
    this.root =
      base.length === 0
        ? null
        : this.createNode({
            kind: "rope",
            rope: base,
            start: 0,
            end: base.length,
            // Conservative for a sliced range. A false positive only keeps a
            // caller's UTF-16 boundary check enabled.
            hasSurrogateCodeUnits: base.hasSurrogateCodeUnits,
          });
  }

  get length(): number {
    return this.finished?.length ?? nodeLength(this.root);
  }

  get hasSurrogateCodeUnits(): boolean {
    return (
      this.finished?.hasSurrogateCodeUnits ??
      this.root?.hasSurrogateCodeUnits ??
      false
    );
  }

  codeUnitAt(index: number): number | undefined {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) {
      return undefined;
    }
    if (this.finished !== null) {
      return this.finished.codeUnitAt(index);
    }

    let node = this.root;
    let offset = index;
    while (node !== null) {
      const leftLength = nodeLength(node.left);
      if (offset < leftLength) {
        node = node.left;
        continue;
      }
      const ownLength = pieceLength(node.piece);
      if (offset < leftLength + ownLength) {
        const pieceOffset = node.piece.start + offset - leftLength;
        return node.piece.kind === "rope"
          ? node.piece.rope.codeUnitAt(pieceOffset)
          : node.piece.text.charCodeAt(pieceOffset);
      }
      offset -= leftLength + ownLength;
      node = node.right;
    }
    return undefined;
  }

  insert(index: number, text: string): void {
    this.assertOpen();
    assertIndex(index, this.length, true);
    if (text.length === 0) {
      return;
    }

    const [left, right] = this.split(this.root, index);
    const inserted = this.createNode({
      kind: "text",
      text,
      start: 0,
      end: text.length,
      hasSurrogateCodeUnits: containsUtf16SurrogateCodeUnit(text),
    });
    this.root = mergeNodes(mergeNodes(left, inserted), right);
    this.dirty = true;
  }

  delete(index: number, length: number): void {
    this.assertOpen();
    assertRange(index, length, this.length);
    if (length === 0) {
      return;
    }

    const [left, suffix] = this.split(this.root, index);
    const [, right] = this.split(suffix, length);
    this.root = mergeNodes(left, right);
    this.dirty = true;
  }

  /** Freeze once; repeated reads return the same persistent rope root. */
  finish(): PersistentUtf16Rope {
    if (this.finished !== null) {
      return this.finished;
    }
    if (!this.dirty) {
      this.finished = this.base;
      this.root = null;
      return this.finished;
    }

    this.finished = PersistentUtf16Rope.assemble((assembler) => {
      this.appendPieces(assembler);
    });
    this.root = null;
    return this.finished;
  }

  private assertOpen(): void {
    if (this.finished !== null) {
      throw new Error("Cannot edit a finished transient UTF-16 rope");
    }
  }

  private nextPriority(): number {
    let state = this.priorityState;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.priorityState = state >>> 0;
    return this.priorityState;
  }

  private createNode(piece: Piece): PieceNode {
    return new PieceNode(piece, this.nextPriority());
  }

  private split(
    root: PieceNode | null,
    index: number,
  ): readonly [PieceNode | null, PieceNode | null] {
    if (root === null) {
      return [null, null];
    }

    const leftLength = nodeLength(root.left);
    const ownLength = pieceLength(root.piece);
    if (index < leftLength) {
      const [left, right] = this.split(root.left, index);
      root.left = right;
      return [left, updateNode(root)];
    }
    if (index > leftLength + ownLength) {
      const [left, right] = this.split(
        root.right,
        index - leftLength - ownLength,
      );
      root.right = left;
      return [updateNode(root), right];
    }
    if (index === leftLength) {
      const left = root.left;
      root.left = null;
      return [left, updateNode(root)];
    }
    if (index === leftLength + ownLength) {
      const right = root.right;
      root.right = null;
      return [updateNode(root), right];
    }

    const localIndex = index - leftLength;
    const originalPiece = root.piece;
    const originalRight = root.right;
    root.piece = slicePiece(originalPiece, 0, localIndex);
    root.right = null;
    const rightPiece = this.createNode(
      slicePiece(originalPiece, localIndex, ownLength),
    );
    return [updateNode(root), mergeNodes(rightPiece, originalRight)];
  }

  private appendPieces(assembler: Utf16RopeAssembler): void {
    const pieces: Piece[] = [];
    const stack: PieceNode[] = [];
    let current = this.root;
    while (current !== null || stack.length > 0) {
      while (current !== null) {
        stack.push(current);
        current = current.left;
      }
      current = stack.pop()!;
      const previous = pieces[pieces.length - 1];
      const combined =
        previous === undefined
          ? null
          : combineAdjacentPieces(previous, current.piece);
      if (combined === null) {
        pieces.push(current.piece);
      } else {
        pieces[pieces.length - 1] = combined;
      }
      current = current.right;
    }

    const boundariesByRope = new Map<
      PersistentUtf16Rope,
      ReadonlyArray<number>
    >();
    for (let index = 0; index < pieces.length; index++) {
      appendCompactedPiece(
        assembler,
        pieces[index]!,
        index > 0,
        index + 1 < pieces.length,
        boundariesByRope,
      );
    }
  }
}

const pieceLength = (piece: Piece): number => piece.end - piece.start;

const nodeLength = (node: PieceNode | null): number => node?.totalLength ?? 0;

const updateNode = (node: PieceNode): PieceNode => {
  node.totalLength =
    nodeLength(node.left) + pieceLength(node.piece) + nodeLength(node.right);
  node.hasSurrogateCodeUnits =
    (node.left?.hasSurrogateCodeUnits ?? false) ||
    node.piece.hasSurrogateCodeUnits ||
    (node.right?.hasSurrogateCodeUnits ?? false);
  return node;
};

const mergeNodes = (
  left: PieceNode | null,
  right: PieceNode | null,
): PieceNode | null => {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  if (left.priority <= right.priority) {
    left.right = mergeNodes(left.right, right);
    return updateNode(left);
  }
  right.left = mergeNodes(left, right.left);
  return updateNode(right);
};

const slicePiece = (piece: Piece, start: number, end: number): Piece => ({
  ...piece,
  start: piece.start + start,
  end: piece.start + end,
});

const combineAdjacentPieces = (left: Piece, right: Piece): Piece | null => {
  if (
    left.kind === "rope" &&
    right.kind === "rope" &&
    left.rope === right.rope &&
    left.end === right.start
  ) {
    return { ...left, end: right.end };
  }
  if (
    left.kind === "text" &&
    right.kind === "text" &&
    left.text === right.text &&
    left.end === right.start
  ) {
    return { ...left, end: right.end };
  }
  return null;
};

const appendCompactedPiece = (
  assembler: Utf16RopeAssembler,
  piece: Piece,
  hasLeftSeam: boolean,
  hasRightSeam: boolean,
  boundariesByRope: Map<PersistentUtf16Rope, ReadonlyArray<number>>,
): void => {
  if (piece.kind === "text") {
    assembler.appendText(piece.text.slice(piece.start, piece.end));
    return;
  }
  if (pieceLength(piece) < UTF16_ROPE_MIN_LEAF) {
    assembler.appendText(piece.rope.slice(piece.start, piece.end));
    return;
  }

  let boundaries = boundariesByRope.get(piece.rope);
  if (boundaries === undefined) {
    boundaries = piece.rope.getLeafBoundaries();
    boundariesByRope.set(piece.rope, boundaries);
  }

  let sharedStartIndex = lowerBound(boundaries, piece.start);
  let sharedEndIndex = upperBound(boundaries, piece.end) - 1;
  if (sharedStartIndex >= sharedEndIndex) {
    assembler.appendText(piece.rope.slice(piece.start, piece.end));
    return;
  }

  // Copy the source leaf on each edited seam into the assembler's pending
  // text. Adjacent seam windows then coalesce and are re-chunked together,
  // while exact interior leaf ranges still retain identity.
  const hasPartialLeft = boundaries[sharedStartIndex] !== piece.start;
  const hasPartialRight = boundaries[sharedEndIndex] !== piece.end;
  if (hasLeftSeam || hasPartialLeft) {
    sharedStartIndex++;
  }
  if (sharedStartIndex < sharedEndIndex && (hasRightSeam || hasPartialRight)) {
    sharedEndIndex--;
  }

  const sharedStart = boundaries[sharedStartIndex]!;
  const sharedEnd = boundaries[sharedEndIndex]!;
  if (piece.start < sharedStart) {
    assembler.appendText(piece.rope.slice(piece.start, sharedStart));
  }
  if (sharedStart < sharedEnd) {
    assembler.appendLeafRange(piece.rope, sharedStartIndex, sharedEndIndex);
  }
  if (sharedEnd < piece.end) {
    assembler.appendText(piece.rope.slice(sharedEnd, piece.end));
  }
};

const lowerBound = (values: ReadonlyArray<number>, target: number): number => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle]! < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const upperBound = (values: ReadonlyArray<number>, target: number): number => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle]! <= target) {
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
    throw new Error(
      `Invalid transient rope index ${index} for length ${length}`,
    );
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
      `Invalid transient rope delete range [${index}, ${index + length}) for length ${total}`,
    );
  }
};
