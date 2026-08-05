import {
  type DirectionalSelectionRange,
  isDirectionalSelectionRange,
  type PresenceUser,
} from "@softmaple/awareness";
import type {
  LexicalBinding,
  LogicalSelection,
  LogicalSelectionPoint,
  StableBlockSelection,
} from "@softmaple/binding-lexical";

export interface OverlayRect {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

export interface PeerGeometry {
  readonly backward: boolean;
  readonly caret: OverlayRect | null;
  readonly peer: PresenceUser;
  readonly selection: ReadonlyArray<OverlayRect>;
}

interface DomPoint {
  readonly node: Node;
  readonly offset: number;
}

interface DomUnit {
  readonly from: number;
  readonly to: number;
  readonly node: Node;
  readonly parent: Node;
  readonly childIndex: number;
  readonly type: "text" | "break";
}

const childIndex = (node: ChildNode): number =>
  node.parentNode === null
    ? 0
    : Array.from(node.parentNode.childNodes).indexOf(node);

const collectUnits = (
  node: Node,
  units: DomUnit[],
  initialOffset = 0,
): number => {
  let offset = initialOffset;
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const length = child.textContent?.length ?? 0;
      units.push({
        from: offset,
        to: offset + length,
        node: child,
        parent: node,
        childIndex: childIndex(child),
        type: "text",
      });
      offset += length;
      continue;
    }
    if (!(child instanceof HTMLElement)) continue;
    if (child.tagName === "BR") {
      units.push({
        from: offset,
        to: offset + 1,
        node: child,
        parent: node,
        childIndex: childIndex(child),
        type: "break",
      });
      offset++;
      continue;
    }
    if (child.tagName === "UL" || child.tagName === "OL") continue;
    offset = collectUnits(child, units, offset);
  }
  return offset;
};

const resolveDomPoint = (
  binding: LexicalBinding,
  point: LogicalSelectionPoint,
): DomPoint | null => {
  const key = binding.getBlockIndex().blockIdToNodeKey.get(point.blockId);
  if (key === undefined) return null;
  const block = binding.editor.getElementByKey(key);
  if (block === null) return null;
  const units: DomUnit[] = [];
  const length = collectUnits(block, units);
  const offset = Math.max(0, Math.min(length, point.offset));
  const text = units.find(
    (unit) => unit.type === "text" && offset >= unit.from && offset <= unit.to,
  );
  if (text !== undefined) {
    return { node: text.node, offset: offset - text.from };
  }
  const next = units.find((unit) => unit.from >= offset);
  if (next !== undefined) {
    return { node: next.parent, offset: next.childIndex };
  }
  return { node: block, offset: block.childNodes.length };
};

const collapsedRange = (point: DomPoint): Range => {
  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  return range;
};

const relativeRect = (
  rect: DOMRect,
  host: DOMRect,
  minimumWidth = 0,
): OverlayRect => ({
  left: rect.left - host.left,
  top: rect.top - host.top,
  width: Math.max(minimumWidth, rect.width),
  height: Math.max(18, rect.height),
});

const toStableSelection = (
  selection: DirectionalSelectionRange,
): StableBlockSelection => selection;

export const resolvePeerSelection = (
  binding: Pick<LexicalBinding, "resolveSelection">,
  peer: PresenceUser,
): LogicalSelection | null => {
  if (!isDirectionalSelectionRange(peer.selection)) return null;
  try {
    return binding.resolveSelection(toStableSelection(peer.selection));
  } catch {
    return null;
  }
};

export const measurePeer = (
  binding: LexicalBinding,
  host: HTMLElement,
  peer: PresenceUser,
): PeerGeometry | null => {
  const logical = resolvePeerSelection(binding, peer);
  if (logical === null) return null;
  const anchor = resolveDomPoint(binding, logical.anchor);
  const focus = resolveDomPoint(binding, logical.focus);
  if (anchor === null || focus === null) return null;

  const anchorRange = collapsedRange(anchor);
  const focusRange = collapsedRange(focus);
  const backward =
    anchorRange.compareBoundaryPoints(Range.START_TO_START, focusRange) > 0;
  const start = backward ? focus : anchor;
  const end = backward ? anchor : focus;
  const selectionRange = document.createRange();
  selectionRange.setStart(start.node, start.offset);
  selectionRange.setEnd(end.node, end.offset);
  const hostRect = host.getBoundingClientRect();
  const selection = Array.from(selectionRange.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => relativeRect(rect, hostRect));
  const focusRect =
    focusRange.getClientRects()[0] ?? focusRange.getBoundingClientRect();
  const caret =
    focusRect.height > 0
      ? relativeRect(focusRect, hostRect, 2)
      : {
          left: focusRect.left - hostRect.left,
          top: focusRect.top - hostRect.top,
          width: 2,
          height: 20,
        };
  return { backward, caret, peer, selection };
};
