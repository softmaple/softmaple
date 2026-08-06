/**
 * EditorSurface — uncontrolled textarea + awareness overlays (live
 * cursors, selection highlights, per-block activity badge).
 *
 * Diff / IME guards / remote-op application all live in the
 * `@softmaple/awareness/bindings/textarea` adapter, which the route
 * owns. This component only handles awareness-presence concerns:
 * broadcasting the local user's cursor/selection/typing, and rendering
 * the peer overlay layer. The `isComposing` prop comes from the
 * adapter so we can suppress presence broadcasts during in-progress
 * IME composition (peers can't render an intermediate composition span
 * anyway, and broadcasting partial pinyin produces noisy cursor jumps).
 */

import {
  getTextareaCaretRect,
  getTextareaSelectionRects,
  type HighlightRect,
  isLegacySelectionRange,
  LiveCursor,
  PresenceLayer,
  SelectionHighlight,
  type SelectionRange,
  useOthers,
  useUpdateCursor,
  useUpdateSelection,
  useUpdateTyping,
} from "@softmaple/awareness";
import { useEffect, useMemo, useRef } from "react";
import { BlockActivityBadge } from "./BlockActivityBadge";

/**
 * Shared block id for the demo's single editable surface. Exported so the
 * route owner can pass the same id back to the CRDT/sync layer without
 * having to redeclare it.
 */
export const COLLAB_BLOCK_ID = "awareness-collab-doc";

interface EditorSurfaceProps {
  readonly blockId: string;
  /**
   * Authoritative text snapshot (post-binding-apply). Used as a cache
   * key for the peer overlay measurement memo and to slice the
   * selected-text aria-label for peer selections. Does NOT drive the
   * textarea's value — the binding owns DOM writes imperatively.
   */
  readonly text: string;
  readonly textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly trainerId: string;
  /**
   * Adapter probe for in-progress IME composition. Used to gate the
   * local presence broadcasts so we don't fire cursor/selection updates
   * mid-pinyin.
   */
  readonly isComposing: () => boolean;
}

export function EditorSurface({
  blockId,
  text,
  textareaRef,
  trainerId,
  isComposing,
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

  const armTypingIndicator = () => {
    updateTyping(true);
    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
    }
    typingTimerRef.current = window.setTimeout(() => {
      updateTyping(false);
      typingTimerRef.current = null;
    }, 800);
  };

  // The adapter owns the IME state machine; we just consult it here so
  // a presence broadcast never fires for an in-progress composition.
  const maybePushSelection = () => {
    if (isComposing()) return;
    pushSelection();
  };

  const handleInput = () => {
    if (isComposing()) return;
    pushSelection();
    armTypingIndicator();
  };

  // `getTextareaCaretRect` / `getTextareaSelectionRects` return
  // *textarea content* coordinates (no scroll subtraction); `<PresenceLayer
  // trackHostScroll />` folds `textarea.scrollLeft` / `scrollTop` into
  // the offset so we never have to subtract them ourselves.
  //
  // Both helpers under the hood mount + measure + unmount a mirror
  // <div> per call, so calling them inside the JSX (once per peer per
  // render) churned the DOM on every render. Memoize them in a single
  // pass keyed on `others`, `blockId`, and `text`. `text` isn't read
  // by `getTextareaSelectionRects` (which measures the live DOM), but
  // a local edit shifts the textarea's measured geometry, so it's a
  // real cache key for both maps; computing them together keeps that
  // key honest in one place.
  const { cursorPoints, selectionRects } = useMemo(() => {
    const el = textareaRef.current;
    const cursors = new Map<string, { x: number; y: number }>();
    const selections = new Map<string, ReadonlyArray<HighlightRect>>();
    if (!el) return { cursorPoints: cursors, selectionRects: selections };
    for (const peer of others) {
      if (peer.cursor?.blockId === blockId) {
        const local = getTextareaCaretRect(
          el,
          Math.min(peer.cursor.offset, text.length),
        );
        cursors.set(peer.userId, { x: local.left, y: local.top });
      }
      if (
        isLegacySelectionRange(peer.selection) &&
        peer.selection.blockId === blockId
      ) {
        const rects = getTextareaSelectionRects(el, peer.selection);
        if (rects.length > 0) selections.set(peer.userId, rects);
      }
    }
    return { cursorPoints: cursors, selectionRects: selections };
  }, [others, blockId, text, textareaRef]);

  return (
    <div className="relative">
      <div
        ref={editorBoxRef}
        className="pg-panel relative overflow-hidden"
        // The testid uses the bare `trainerId`, not the per-tab
        // `userInfo.userId` (which has a tabTag suffix). Safe because
        // one tab mounts one EditorSurface, but the e2e tests should
        // distinguish tabs through their browser context, not by
        // inspecting two surfaces with the same testid in one DOM.
        data-testid={`editor-surface-${trainerId}`}
      >
        <div className="pg-panel-header flex items-center justify-between gap-2 px-4 py-2">
          <p className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] text-[var(--pg-ink-muted)] uppercase">
            Shared field notes
          </p>
          <BlockActivityBadge blockId={blockId} />
        </div>
        {/* Uncontrolled: the textarea adapter (created by the route via
         *  `useTextareaCollaboration`) owns the DOM value imperatively
         *  and handles all IME composition guards. We only attach the
         *  presence handlers here. */}
        <textarea
          ref={textareaRef}
          onInput={handleInput}
          onSelect={maybePushSelection}
          onKeyUp={maybePushSelection}
          onClick={maybePushSelection}
          onBlur={() => {
            updateTyping(false);
          }}
          placeholder="Type field notes here. Open another tab as a different trainer to collaborate."
          className="min-h-[280px] w-full resize-y bg-transparent p-4 font-[family-name:var(--font-mono)] text-sm leading-relaxed text-[var(--pg-ink)] placeholder:text-[var(--pg-ink-muted)] focus:outline-none sm:min-h-[360px]"
          spellCheck={false}
        />
      </div>

      {/* Awareness overlays. PresenceLayer owns the fixed positioning
       *  layer and translates content-relative coordinates from
       *  `pointFor` / `getTextareaSelectionRects` into screen space.
       *  `trackHostScroll` folds the textarea's internal scroll into
       *  the offset so we hand over textarea-content-relative values
       *  without subtracting `scrollLeft` / `scrollTop` ourselves. */}
      {/*
       *  Cursor and selection overlays explicitly opt OUT of the keyboard
       *  tab order. With N peers, the default `focusable={showLabel === "hover"}`
       *  inserts up to 2N tab stops between the textarea and the rest of
       *  the page. Keyboard users discover peer attribution through the
       *  `<PresenceBar>` roster instead; sighted users still get the
       *  hover label.
       */}
      <PresenceLayer host={textareaRef} trackHostScroll>
        {others.map((peer) => {
          const point = cursorPoints.get(peer.userId);
          if (!point) return null;
          return (
            <LiveCursor
              key={`cursor-${peer.userId}`}
              user={peer}
              point={point}
              showLabel="hover"
              focusable={false}
            />
          );
        })}
        {others.flatMap((peer) => {
          const rects = selectionRects.get(peer.userId);
          // The cache invariant guarantees `peer.selection` is defined
          // whenever `rects` is set (it's the gate that puts the entry
          // into the map). The extra `!peer.selection` check is for
          // the type narrower so the `peer.selection.from` / `.to`
          // reads below don't need a non-null assertion.
          if (!rects || !isLegacySelectionRange(peer.selection)) return [];
          const selectedText = text.slice(
            peer.selection.from,
            peer.selection.to,
          );
          // Only the first rect carries the user-visible label and the
          // full selectedText aria-label; sibling rects render as
          // unlabeled continuations. None are focusable here — keyboard
          // attribution lives in the PresenceBar.
          return rects.map((rect, i) => (
            <SelectionHighlight
              key={`sel-${peer.userId}-${i}`}
              focusable={false}
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
