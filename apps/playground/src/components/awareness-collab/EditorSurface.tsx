/**
 * EditorSurface - textarea + awareness overlays (live cursors, selection
 * highlights, per-block activity badge). Tracks the local user's cursor
 * and selection via awareness hooks so other tabs can render them.
 */

import {
  getTextareaCaretRect,
  getTextareaSelectionRects,
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
import {
  mapTextareaSelectionThroughOperation,
  type TextareaSelection,
  useTextareaSelectionSync,
} from "@softmaple/awareness/hooks";
import type { PositionOperation } from "@softmaple/awareness/mapping";
import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
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
  /**
   * Mapping operations queued by the route's BroadcastChannel handler for
   * remote events that have just been integrated into the local replica.
   * The post-commit layout effect drains and applies them to the captured
   * local selection so the caret rides through peer inserts/deletes
   * instead of staying pinned at its raw byte offset. Owned by the route
   * (a ref so accumulation across multiple events in one tick doesn't
   * race React state); consumed exactly once per `text` commit.
   */
  readonly pendingMappingOperationsRef: RefObject<PositionOperation[]>;
}

export function EditorSurface({
  blockId,
  text,
  onTextChange,
  textareaRef,
  trainerId,
  pendingMappingOperationsRef,
}: EditorSurfaceProps) {
  const others = useOthers();
  const updateCursor = useUpdateCursor();
  const updateSelection = useUpdateSelection();
  const updateTyping = useUpdateTyping();
  const textareaSelectionSync = useTextareaSelectionSync(textareaRef);

  const editorBoxRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  // Tracks whether the user is mid-IME-composition (typing CJK /
  // pinyin / hangul / kana etc). See the long comment on the textarea
  // JSX below for why this matters.
  const composingRef = useRef(false);
  // Holds the value committed by the most recent `compositionend`.
  // Chrome (and WebKit) dispatch a trailing `input` event immediately
  // after `compositionend` with the same post-commit value; the
  // compositionend handler already pushed that value through
  // `onTextChange`, so the next `input` event must swallow the echo
  // instead of re-dispatching. Firefox doesn't fire the trailing
  // input — the ref is consumed on the next input either way (it
  // resets to `null`) so a real subsequent keystroke dispatches
  // normally.
  const lastCompositionCommitRef = useRef<string | null>(null);

  // The textarea is *fully uncontrolled* — we don't pass `value` OR
  // `defaultValue` as a prop, because React's `<textarea>` implementation
  // re-applies BOTH on every commit (unlike `<input>`, where defaultValue
  // is only applied at mount). A re-applied `defaultValue` writes
  // `el.value = text` on every render, which resets the browser caret to
  // 0 — the very next keystroke then inserts at the wrong position. Tab
  // B typing " world" at the end of "Hello" merged as " worldHello" in
  // multi-tab E2E coverage; see `e2e/awareness-collab-merge.spec.ts`.
  //
  // Instead we own the DOM `value` imperatively here: on every commit
  // where `text` differs from the live DOM value, write it and restore
  // the caret via `useTextareaSelectionSync`. Mid-composition we skip
  // the write so we never collapse an in-progress IME composition.
  //
  // When `pendingMappingOperationsRef` has entries, the route's
  // BroadcastChannel handler integrated one or more remote events for
  // this commit; chain the captured selection through those ops so a
  // peer insert before the caret shifts it right (and a peer delete
  // shifts it left / collapses overlapping selections) instead of
  // leaving it pinned at the now-stale raw byte index.
  //
  // `composingRef` is intentionally NOT in the dependency array — it's a
  // ref, and we read its current value at effect time. Adding it would
  // do nothing (refs don't trigger re-renders) and removing the
  // `composingRef.current` guard would re-introduce the IME collapse bug.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (composingRef.current) return;
    if (el.value === text) return;
    const captured = textareaSelectionSync.captureSelection();
    el.value = text;
    const operations = pendingMappingOperationsRef.current;
    if (captured && operations.length > 0) {
      const mapped = operations.reduce<TextareaSelection>(
        (current, op) => mapTextareaSelectionThroughOperation(current, op),
        captured,
      );
      textareaSelectionSync.restoreSelection(mapped);
    } else {
      // `restoreSelection` clamps to `value.length` internally, so peer
      // inserts that shrink the doc past the local caret are safe.
      textareaSelectionSync.restoreSelection(captured);
    }
    pendingMappingOperationsRef.current = [];
  }, [text, textareaRef, textareaSelectionSync, pendingMappingOperationsRef]);

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
    const value = e.target.value;
    // Swallow Chrome / WebKit's trailing post-commit `input` event
    // whose value matches what `handleCompositionEnd` just dispatched.
    // The ref is consumed unconditionally so the very next keystroke
    // (with a different value) dispatches normally; if Firefox skips
    // the trailing input, the ref simply lingers until the next
    // keystroke consumes (and ignores) it.
    if (lastCompositionCommitRef.current !== null) {
      const expected = lastCompositionCommitRef.current;
      lastCompositionCommitRef.current = null;
      if (value === expected) return;
    }
    onTextChange(value);
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
    // ("nihao") that fired during composition. Some browsers (Chrome,
    // WebKit) fire `compositionend` *before* the final `input` event;
    // reading `currentTarget.value` here is still correct because the
    // DOM value was updated synchronously by the IME before either
    // event dispatched. The trailing `input` event echo is suppressed
    // in `handleInput` via `lastCompositionCommitRef`.
    //
    // If a peer edit arrived mid-composition, `text` flipped to the
    // peer's value while the layout-effect sync bailed on the
    // `composingRef` guard — leaving DOM and prop out of sync. The
    // `onTextChange` dispatch below feeds the local commit into the
    // CRDT, which merges with the peer's ops and emits a fresh `text`;
    // that re-render re-runs the layout effect (`composingRef` is
    // false now) and reconciles DOM to the merged value. No explicit
    // reconcile here — doing it before dispatch would briefly clobber
    // the just-committed characters with the peer's text.
    const value = e.currentTarget.value;
    lastCompositionCommitRef.current = value;
    onTextChange(value);
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
  //
  // Both helpers under the hood mount + measure + unmount a mirror
  // <div> per call, so calling them inside the JSX (once per peer per
  // render) churned the DOM on every render. Memoize them in a single
  // pass keyed on `others`, `blockId`, and `text`. `text` isn't read
  // by `getTextareaSelectionRects` (which measures the live DOM), but
  // a local edit shifts the textarea's measured geometry, so it's a
  // real cache key for both maps; computing them together keeps that
  // key honest in one place.
  //
  // Trade-off: `useOthers` returns a new array reference on every
  // presence tick, so the cache invalidates whenever ANY peer moves
  // (not just peers in this block). At N=6 demo peers the win is
  // already worthwhile — we move from O(N) mirror mounts per render
  // to O(N) per tick — and a per-peer ref-cache keyed on `(userId,
  // offset)` would eliminate the over-invalidation but adds a manual
  // invalidation pass on text change. Skipped here pending a real
  // need.
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
      if (peer.selection?.blockId === blockId) {
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
        className="relative rounded-xl border border-slate-700 bg-slate-900/60 overflow-hidden shadow-lg"
        // The testid uses the bare `trainerId`, not the per-tab
        // `userInfo.userId` (which has a tabTag suffix). Safe because
        // one tab mounts one EditorSurface, but the e2e tests should
        // distinguish tabs through their browser context, not by
        // inspecting two surfaces with the same testid in one DOM.
        data-testid={`editor-surface-${trainerId}`}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-slate-800 bg-slate-900/80">
          <p className="text-xs uppercase tracking-widest text-cyan-400 font-semibold">
            Pokédex · Shared Field Notes
          </p>
          <BlockActivityBadge blockId={blockId} />
        </div>
        {/* The textarea is *fully uncontrolled* — no `value` AND no
         *  `defaultValue` prop. React's `<textarea>` implementation
         *  applies BOTH props on every commit (the source applies
         *  `defaultValue` through the same path as `value`), so even
         *  with `defaultValue={text}` a re-render that arrives between
         *  keystrokes would write `el.value = text` and reset the
         *  caret to 0 — the next keystroke then inserts at the wrong
         *  position. The `useLayoutEffect` above owns the DOM value
         *  imperatively, including caret preservation, and bails
         *  during IME composition so we never collapse an in-progress
         *  one.
         */}
        <textarea
          ref={textareaRef}
          onChange={handleInput}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onSelect={maybePushSelection}
          onKeyUp={maybePushSelection}
          onClick={maybePushSelection}
          onBlur={() => {
            // Defensive: a few mobile IMEs / older WebKit builds can
            // drop `compositionend` when focus is yanked out from
            // under an in-progress composition. Without this reset,
            // `composingRef` would stay `true` forever and silently
            // swallow every subsequent keystroke. Worst case on a
            // well-behaved IME this is a no-op (the ref was already
            // false), so it's safe to clear unconditionally.
            composingRef.current = false;
            lastCompositionCommitRef.current = null;
            updateTyping(false);
          }}
          placeholder="Type field notes here. Open another tab as a different trainer to collaborate."
          // `text-gray-600` on `bg-slate-900` rendered the onboarding
          // hint at ~3:1 — placeholders are technically AA-exempt but
          // the cue is real instruction copy and was barely legible.
          // `text-slate-400` lifts it well above 4.5:1.
          className="w-full min-h-[280px] sm:min-h-[360px] resize-y p-4 bg-transparent text-gray-100 placeholder:text-slate-400 focus:outline-none font-mono text-sm leading-relaxed"
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
          if (!rects || !peer.selection) return [];
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
