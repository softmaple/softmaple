/**
 * Which keystrokes open workspace search.
 *
 * Cmd/Ctrl+K is the search shortcut everywhere in the product *except* inside
 * text, where Lexical already uses it to insert a link. Rather than pick one
 * and break the other, the shortcut is claimed only when the keystroke did not
 * land in an editable target — so typing in the document keeps link insertion,
 * and pressing it anywhere else opens search.
 *
 * `/` is kept as well: it was the existing shortcut and costs nothing.
 */

const EDITABLE_SELECTOR =
  "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']";

export type SearchShortcutEvent = {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly defaultPrevented: boolean;
  readonly isComposing: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  readonly shiftKey: boolean;
  readonly target: EventTarget | null;
};

/** True when the keystroke landed somewhere text is being entered. */
export const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null;

/**
 * Whether this event should focus the search field.
 *
 * Deliberately conservative: a repeat, a composition, an already-handled
 * event, or an extra modifier all mean "not this shortcut". Guessing here
 * would steal a keystroke from something that wanted it.
 */
export const opensSearch = (event: SearchShortcutEvent): boolean => {
  if (event.defaultPrevented || event.isComposing || event.repeat) return false;
  if (event.altKey || event.shiftKey) return false;

  const modified = event.metaKey || event.ctrlKey;

  if (event.key.toLowerCase() === "k" && modified) {
    // Inside text this is Lexical's insert-link shortcut, and it stays that
    // way. Search is reachable from the visible field instead.
    return !isEditableTarget(event.target);
  }

  if (event.key === "/" && !modified) {
    return !isEditableTarget(event.target);
  }

  return false;
};
