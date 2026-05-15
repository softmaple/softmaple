/**
 * EditorSurface - textarea + awareness overlays (live cursors, selection
 * highlights, per-block activity badge). Tracks the local user's cursor
 * and selection via awareness hooks so other tabs can render them.
 */

import {
  LiveCursor,
  SelectionHighlight,
  type SelectionRange,
  useOthers,
  useUpdateCursor,
  useUpdateSelection,
  useUpdateTyping,
} from "@softmaple/awareness";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const [editorRect, setEditorRect] = useState<DOMRect | null>(null);
  const typingTimerRef = useRef<number | null>(null);

  // Track the editor box for overlay positioning. Recompute on resize.
  useLayoutEffect(() => {
    const update = () => {
      if (editorBoxRef.current) {
        setEditorRect(editorBoxRef.current.getBoundingClientRect());
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (editorBoxRef.current) ro.observe(editorBoxRef.current);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, []);

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

  // Compute a screen-relative point for an offset in the textarea.
  const pointFor = (offset: number) => {
    const el = textareaRef.current;
    if (!el || !editorRect) return null;
    const local = caretCoordinates(el, Math.min(offset, text.length));
    return {
      x: editorRect.left + local.left - el.scrollLeft,
      y: editorRect.top + local.top - el.scrollTop,
    };
  };

  // Compute a screen-relative rect for a selection range. Naive
  // single-line bounding box — sufficient for the demo and matches
  // SelectionHighlight's contract (HighlightRect with x,y,width,height).
  const rectFor = (range: SelectionRange) => {
    const el = textareaRef.current;
    if (!el || !editorRect) return null;
    const from = caretCoordinates(el, Math.min(range.from, text.length));
    const to = caretCoordinates(el, Math.min(range.to, text.length));
    const lineHeight = to.height || from.height || 20;
    if (from.top === to.top) {
      return {
        x: editorRect.left + from.left - el.scrollLeft,
        y: editorRect.top + from.top - el.scrollTop,
        width: Math.max(2, to.left - from.left),
        height: lineHeight,
      };
    }
    // Multi-line: span from `from` to right edge of editor as a coarse
    // approximation. The demo seldom selects across many lines.
    return {
      x: editorRect.left + from.left - el.scrollLeft,
      y: editorRect.top + from.top - el.scrollTop,
      width: editorRect.width - (from.left - el.scrollLeft) - 24,
      height: to.top - from.top + lineHeight,
    };
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

      {/* Awareness overlays. Rendered as a position:fixed layer so cursor
       *  coordinates are screen-relative and survive scroll. */}
      {editorRect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-30"
        >
          {others.map((peer) => {
            if (peer.cursor && peer.cursor.blockId === blockId) {
              const point = pointFor(peer.cursor.offset);
              if (!point) return null;
              return (
                <LiveCursor
                  key={`cursor-${peer.userId}`}
                  user={peer}
                  point={point}
                />
              );
            }
            return null;
          })}
          {others.map((peer) => {
            if (peer.selection && peer.selection.blockId === blockId) {
              const rect = rectFor(peer.selection);
              if (!rect) return null;
              const selectedText = text.slice(
                peer.selection.from,
                peer.selection.to,
              );
              return (
                <SelectionHighlight
                  key={`sel-${peer.userId}`}
                  user={peer}
                  rect={rect}
                  selectedText={selectedText}
                  showLabel="hover"
                />
              );
            }
            return null;
          })}
        </div>
      ) : null}
    </div>
  );
}
