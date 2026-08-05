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
import { type RefObject, useLayoutEffect, useRef, useState } from "react";

interface OverlayRect {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

interface PeerGeometry {
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

export interface RemoteSelectionLayerProps {
  readonly binding: LexicalBinding | null;
  readonly hostRef: RefObject<HTMLDivElement | null>;
  readonly selfId: string;
  readonly users: ReadonlyArray<PresenceUser>;
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

const measurePeer = (
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

export function RemoteSelectionLayer({
  binding,
  hostRef,
  selfId,
  users,
}: RemoteSelectionLayerProps) {
  const [geometry, setGeometry] = useState<ReadonlyArray<PeerGeometry>>([]);
  const usersRef = useRef(users);
  usersRef.current = users;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (binding === null || host === null) {
      setGeometry([]);
      return;
    }
    let frame = 0;
    const measure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setGeometry(
          usersRef.current.flatMap((peer) => {
            if (peer.userId === selfId) return [];
            const measured = measurePeer(binding, host, peer);
            return measured === null ? [] : [measured];
          }),
        );
      });
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    const mutationObserver = new MutationObserver(measure);
    resizeObserver.observe(host);
    mutationObserver.observe(host, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const unsubscribeReplica = binding.replica.subscribe(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      unsubscribeReplica();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [binding, hostRef, selfId]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {geometry.flatMap(({ peer, selection }) =>
        selection.map((rect) => (
          <span
            key={`${peer.userId}:selection:${rect.left}:${rect.top}:${rect.width}:${rect.height}`}
            data-testid={`remote-selection-${peer.userId}`}
            className="absolute rounded-[3px]"
            style={{
              backgroundColor: `${peer.color}2E`,
              boxShadow: `inset 0 -1px 0 ${peer.color}70`,
              height: rect.height,
              left: rect.left,
              top: rect.top,
              width: rect.width,
            }}
          />
        )),
      )}
      {geometry.map(({ backward, caret, peer }) =>
        caret === null ? null : (
          <span
            key={`${peer.userId}:caret`}
            data-testid={`remote-caret-${peer.userId}`}
            className="absolute rounded-full"
            style={{
              backgroundColor: peer.color,
              height: caret.height,
              left: caret.left,
              top: caret.top,
              width: 2,
            }}
          >
            <span
              className="absolute left-0 top-0 -translate-y-full whitespace-nowrap rounded-t-md rounded-br-md px-1.5 py-0.5 text-[9px] font-bold text-white"
              style={{ backgroundColor: peer.color }}
            >
              {peer.name} {backward ? "↖" : "↘"}
            </span>
          </span>
        ),
      )}
    </div>
  );
}
