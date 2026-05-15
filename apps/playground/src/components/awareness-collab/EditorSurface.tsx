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
import { useEffect, useLayoutEffect, useRef } from "react";
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
  // Tracks whether the user is mid-IME-composition (typing CJK /
  // pinyin / hangul / kana etc). See the long comment on the textarea
  // JSX below for why this matters.
  const composingRef = useRef(false);

  // The textarea is *uncontrolled* (see `defaultValue` below). This
  // effect is what keeps the DOM `value` in sync with the `text` prop
  // for changes that originate outside the textarea — remote peer
  // edits applied via `setText(replica.getText())` upstream. Local
  // edits go textarea → `onTextChange` → `setText` → here, and the
  // `el.value !== text` guard makes that a no-op so we don't fight the
  // browser's caret. Mid-composition we deliberately skip the sync;
  // overwriting `el.value` while an IME is composing collapses the
  // composition.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (composingRef.current) return;
    if (el.value === text) return;
    const { selectionStart, selectionEnd } = el;
    el.value = text;
    // Best-effort cursor preservation. If a peer inserted before our
    // caret the offset will be off by the diff length — acceptable for
    // the demo; a real editor would translate selection through the
    // CRDT op. setSelectionRange clamps internally so out-of-range
    // values are safe.
    el.setSelectionRange(selectionStart, selectionEnd);
  }, [text, textareaRef]);

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

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Mid-IME-composition the textarea fires intermediate `input`
    // events with the latin pinyin ("n", "ni", "nih", "niha", "nihao")
    // before committing the final CJK text on `compositionend`.
    // Diffing those into the eg-walker CRDT produces per-keystroke
    // insert ops and a wrong final delete-3 / insert-2 pair that
    // doesn't reconcile with the final composition. We also can't
    // call any awareness `updatePresence` here — the adapter's
    // `onPresenceChange` listener synchronously triggers `setSelf` /
    // `setPresence` in `PresenceProvider`, which re-renders this
    // component. Even though the textarea is uncontrolled now, we
    // still avoid the broadcast traffic for intermediate states.
    if (composingRef.current) return;
    onTextChange(e.target.value);
    pushSelection();
    armTypingIndicator();
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
    // Intentionally no `armTypingIndicator()` here. See the comment
    // in `handleInput` above — any `updatePresence` call during
    // composition cascades into a re-render of this component, and
    // historically (when the textarea was controlled) that re-render
    // collapsed the IME composition. The textarea is uncontrolled now
    // so a re-render wouldn't directly clobber the DOM value, but we
    // still don't want to broadcast a stream of "typing" updates for
    // an in-progress composition the peers can't see anyway.
  };

  const handleCompositionEnd = (
    e: React.CompositionEvent<HTMLTextAreaElement>,
  ) => {
    composingRef.current = false;
    // One diff for the entire composition. `currentTarget.value` is
    // the post-commit text (e.g. "你好"), not the latin intermediate
    // ("nihao") that fired during composition. Some browsers (Chrome)
    // fire `compositionend` *before* the final `input` event; reading
    // `currentTarget.value` here is still correct because the DOM
    // value was updated synchronously by the IME before either event
    // dispatched.
    onTextChange(e.currentTarget.value);
    pushSelection();
    armTypingIndicator();
  };

  // `onSelect` / `onKeyUp` / `onClick` all funnel through this so
  // selectionchange events fired by the IME mid-composition (which
  // some browsers do for the composition span itself) don't get
  // broadcast as the user's "real" selection.
  const maybePushSelection = () => {
    if (composingRef.current) return;
    pushSelection();
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
        {/* The textarea is *uncontrolled* (`defaultValue`, not
         *  `value`). This matters specifically for IME composition.
         *
         *  A controlled `value={text}` textarea makes React run a
         *  reconciliation step on every re-render that compares the
         *  `value` prop against the live DOM value and, if they
         *  differ, writes the prop back onto the DOM. During an IME
         *  composition the DOM holds the in-progress text ("nihao")
         *  while the React state still holds the pre-composition
         *  value (""), and any re-render — from `updatePresence`,
         *  `useOthers()`, a peer's cursor moving, anything — would
         *  clobber the DOM back to the prop value and collapse the
         *  composition. Making the textarea uncontrolled removes
         *  that reconciliation step entirely. We sync external
         *  changes (peer edits) back into the DOM imperatively in
         *  the `useLayoutEffect` above, which is allowed to skip
         *  writes while `composingRef.current` is true.
         */}
        <textarea
          ref={textareaRef}
          defaultValue={text}
          onChange={handleInput}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onSelect={maybePushSelection}
          onKeyUp={maybePushSelection}
          onClick={maybePushSelection}
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
