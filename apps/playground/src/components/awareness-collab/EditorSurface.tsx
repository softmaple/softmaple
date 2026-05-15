/**
 * EditorSurface - textarea + awareness overlays (live cursors, selection
 * highlights, per-block activity badge). Tracks the local user's cursor
 * and selection via awareness hooks so other tabs can render them.
 */

import {
  getTextareaCaretRect,
  getTextareaSelectionRects,
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

  // `getTextareaCaretRect` / `getTextareaSelectionRects` return
  // *textarea content* coordinates (no scroll subtraction); `<PresenceLayer
  // trackHostScroll />` folds `textarea.scrollLeft` / `scrollTop` into
  // the offset so we never have to subtract them ourselves. The whole
  // per-line rect ceremony lives in `@softmaple/awareness` now so any
  // other consumer building a textarea-backed editor gets the same
  // implementation — and the same set of tests — instead of
  // reinventing it with subtly different bugs.
  const pointFor = (offset: number) => {
    const el = textareaRef.current;
    if (!el) return null;
    const local = getTextareaCaretRect(el, Math.min(offset, text.length));
    return { x: local.left, y: local.top };
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
       *  layer and translates content-relative coordinates from
       *  `pointFor` / `getTextareaSelectionRects` into screen space.
       *  `trackHostScroll` folds the textarea's internal scroll into
       *  the offset so we hand over textarea-content-relative values
       *  without subtracting `scrollLeft` / `scrollTop` ourselves. */}
      <PresenceLayer host={textareaRef} trackHostScroll>
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
          const el = textareaRef.current;
          if (!el) return [];
          const rects = getTextareaSelectionRects(el, peer.selection);
          if (rects.length === 0) return [];
          const selectedText = text.slice(
            peer.selection.from,
            peer.selection.to,
          );
          // Only the first rect carries the user-visible label, the
          // full selectedText aria-label, and an opt-in tab stop;
          // sibling rects render as unlabeled, non-focusable
          // continuations so a single wrapped selection doesn't burn
          // 3 tab stops on the host.
          return rects.map((rect, i) => (
            <SelectionHighlight
              key={`sel-${peer.userId}-${i}`}
              focusable={i === 0}
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
