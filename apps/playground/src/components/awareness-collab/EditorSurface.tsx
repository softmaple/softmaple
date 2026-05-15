/**
 * EditorSurface - textarea + awareness overlays (live cursors, selection
 * highlights, per-block activity badge). Tracks the local user's cursor
 * and selection via awareness hooks so other tabs can render them.
 */

import {
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

  // Naive single-line bounding rect — sufficient for the demo and matches
  // SelectionHighlight's contract (HighlightRect with x,y,width,height).
  const rectFor = (range: SelectionRange) => {
    const el = textareaRef.current;
    if (!el) return null;
    const from = caretCoordinates(el, Math.min(range.from, text.length));
    const to = caretCoordinates(el, Math.min(range.to, text.length));
    const lineHeight = to.height || from.height || 20;
    if (from.top === to.top) {
      return {
        x: from.left - el.scrollLeft,
        y: from.top - el.scrollTop,
        width: Math.max(2, to.left - from.left),
        height: lineHeight,
      };
    }
    // Multi-line: span from `from` to the textarea's right edge as a
    // coarse approximation. The demo seldom selects across many lines.
    return {
      x: from.left - el.scrollLeft,
      y: from.top - el.scrollTop,
      width: el.clientWidth - (from.left - el.scrollLeft) - 24,
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
      </PresenceLayer>
    </div>
  );
}
