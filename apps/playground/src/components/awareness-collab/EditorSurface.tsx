/**
 * EditorSurface - textarea + awareness overlays (live cursors, selection
 * highlights, per-block activity badge). Tracks the local user's cursor
 * and selection via awareness hooks so other tabs can render them.
 */

import {
  type HighlightRect,
  LiveCursor,
  PresenceLayer,
  SelectionHighlight,
  type SelectionRange,
  useOthers,
  useUpdateCursor,
  useUpdateSelection,
  useUpdateTyping,
} from "@softmaple/awareness";
import { useEffect, useRef } from "react";
import { caretCoordinates } from "@/modules/awareness-collab/caret-coordinates";
import { BlockActivityBadge } from "./BlockActivityBadge";

/**
 * Shared block id for the demo's single editable surface. Exported so the
 * route owner can pass the same id back to the CRDT/sync layer without
 * having to redeclare it.
 */
export const COLLAB_BLOCK_ID = "awareness-collab-doc";

interface EditorSurfaceProps {
  readonly blockId: string;
  readonly text: string;
  readonly onTextChange: (newText: string) => void;
  readonly textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly trainerId: string;
}

export function EditorSurface({
  blockId,
  text,
  onTextChange,
  textareaRef,
  trainerId,
}: EditorSurfaceProps) {
  const others = useOthers();
  const updateCursor = useUpdateCursor();
  const updateSelection = useUpdateSelection();
  const updateTyping = useUpdateTyping();

  const editorBoxRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<number | null>(null);

  // Clear typing indicator after a short idle period.
  useEffect(() => {
    return () => {
      if (typingTimerRef.current !== null) {
        window.clearTimeout(typingTimerRef.current);
      }
    };
  }, []);

  const pushSelection = () => {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    updateCursor({ blockId: blockId, offset: selectionEnd });
    if (selectionStart !== selectionEnd) {
      const range: SelectionRange = {
        blockId: blockId,
        from: selectionStart,
        to: selectionEnd,
      };
      updateSelection(range);
    } else {
      updateSelection(undefined);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onTextChange(e.target.value);
    pushSelection();
    updateTyping(true);
    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
    }
    typingTimerRef.current = window.setTimeout(() => {
      updateTyping(false);
      typingTimerRef.current = null;
    }, 800);
  };

  // Coordinates returned here are *host-local* (relative to the textarea
  // top-left, post-scroll). PresenceLayer translates them to screen space
  // on render, so we never have to reach for `getBoundingClientRect`.
  const pointFor = (offset: number) => {
    const el = textareaRef.current;
    if (!el) return null;
    const local = caretCoordinates(el, Math.min(offset, text.length));
    return {
      x: local.left - el.scrollLeft,
      y: local.top - el.scrollTop,
    };
  };

  // Build one rect per visible line so wrapped selections render the way
  // browsers natively highlight text — line 1 from `from.left` to the
  // content right edge, full-width middle lines, last line from the
  // content left edge to `to.left`. A single bounding rect would paint a
  // giant block over unselected content between the wrap boundaries.
  const rectsFor = (range: SelectionRange): HighlightRect[] => {
    const el = textareaRef.current;
    if (!el) return [];
    const fromOff = Math.min(range.from, text.length);
    const toOff = Math.min(range.to, text.length);
    if (fromOff >= toOff) return [];

    const start = caretCoordinates(el, fromOff);
    const end = caretCoordinates(el, toOff);
    const lineHeight = start.height || end.height || 20;

    if (start.top === end.top) {
      return [
        {
          x: start.left - el.scrollLeft,
          y: start.top - el.scrollTop,
          width: Math.max(2, end.left - start.left),
          height: lineHeight,
        },
      ];
    }

    const cs = window.getComputedStyle(el);
    const padLeft = Number.parseFloat(cs.paddingLeft) || 0;
    const padRight = Number.parseFloat(cs.paddingRight) || 0;
    const contentLeft = padLeft;
    const contentRight = el.clientWidth - padRight;
    const contentWidth = Math.max(2, contentRight - contentLeft);

    const rects: HighlightRect[] = [];
    rects.push({
      x: start.left - el.scrollLeft,
      y: start.top - el.scrollTop,
      width: Math.max(2, contentRight - start.left),
      height: lineHeight,
    });
    const middleLines = Math.max(
      0,
      Math.round((end.top - start.top) / lineHeight) - 1,
    );
    for (let i = 0; i < middleLines; i++) {
      rects.push({
        x: contentLeft - el.scrollLeft,
        y: start.top + (i + 1) * lineHeight - el.scrollTop,
        width: contentWidth,
        height: lineHeight,
      });
    }
    rects.push({
      x: contentLeft - el.scrollLeft,
      y: end.top - el.scrollTop,
      width: Math.max(2, end.left - contentLeft),
      height: lineHeight,
    });
    return rects;
  };

  return (
    <div className="relative">
      <div
        ref={editorBoxRef}
        className="relative rounded-xl border border-slate-700 bg-slate-900/60 overflow-hidden shadow-lg"
        data-testid={`editor-surface-${trainerId}`}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-slate-800 bg-slate-900/80">
          <p className="text-xs uppercase tracking-widest text-cyan-400 font-semibold">
            Pokédex · Shared Field Notes
          </p>
          <BlockActivityBadge blockId={blockId} />
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onSelect={pushSelection}
          onKeyUp={pushSelection}
          onClick={pushSelection}
          onBlur={() => updateTyping(false)}
          placeholder="Type field notes here. Open another tab as a different trainer to collaborate."
          className="w-full min-h-[280px] sm:min-h-[360px] resize-y p-4 bg-transparent text-gray-100 placeholder:text-gray-600 focus:outline-none font-mono text-sm leading-relaxed"
          spellCheck={false}
        />
      </div>

      {/* Awareness overlays. PresenceLayer owns the fixed positioning
       *  layer and translates host-local coordinates from `pointFor` /
       *  `rectFor` into screen space, so we never compute screen offsets
       *  here. */}
      <PresenceLayer host={textareaRef}>
        {others.map((peer) => {
          if (peer.cursor && peer.cursor.blockId === blockId) {
            const point = pointFor(peer.cursor.offset);
            if (!point) return null;
            return (
              <LiveCursor
                key={`cursor-${peer.userId}`}
                user={peer}
                point={point}
                showLabel="hover"
              />
            );
          }
          return null;
        })}
        {others.flatMap((peer) => {
          if (!peer.selection || peer.selection.blockId !== blockId) return [];
          const rects = rectsFor(peer.selection);
          if (rects.length === 0) return [];
          const selectedText = text.slice(
            peer.selection.from,
            peer.selection.to,
          );
          // Only the first rect carries the user-visible label and the
          // full selectedText aria-label; sibling rects render as
          // unlabeled continuations of the same selection.
          return rects.map((rect, i) => (
            <SelectionHighlight
              key={`sel-${peer.userId}-${i}`}
              user={peer}
              rect={rect}
              selectedText={i === 0 ? selectedText : undefined}
              showLabel={i === 0 ? "hover" : false}
            />
          ));
        })}
      </PresenceLayer>
    </div>
  );
}
