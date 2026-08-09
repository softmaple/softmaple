import {
  isDirectionalSelectionRange,
  isStableCursorPosition,
  type PresenceUser,
} from "@softmaple/awareness";
import type {
  LexicalBinding,
  LogicalSelection,
  StableBlockSelection,
} from "@softmaple/binding-lexical";
import {
  InvalidSequenceAtomError,
  UnknownSequenceAtomError,
} from "@softmaple/block-model";

/** Hard anchor errors that must not take down every remote caret. */
export const isIsolatablePresenceAnchorError = (error: unknown): boolean =>
  error instanceof InvalidSequenceAtomError ||
  error instanceof UnknownSequenceAtomError;

/**
 * Resolve a remote presence selection against the local replica.
 * Returns `null` when the selection is absent or temporarily unresolved.
 */
export const resolveRemotePresenceSelection = (
  binding: Pick<LexicalBinding, "tryResolveSelection">,
  user: PresenceUser,
): LogicalSelection | null => {
  const selection = isDirectionalSelectionRange(user.selection)
    ? user.selection
    : null;
  const cursor = isStableCursorPosition(user.cursor) ? user.cursor : null;
  if (selection === null && cursor === null) return null;

  const stableSelection: StableBlockSelection =
    selection === null
      ? { anchor: cursor!, focus: cursor! }
      : { anchor: selection.anchor, focus: selection.focus };
  const resolved = binding.tryResolveSelection(stableSelection);
  return resolved.status === "resolved" ? resolved.selection : null;
};

/**
 * Map remote presence users one-by-one, skipping temporarily unresolved or
 * isolatable hard-anchor failures without aborting the whole overlay.
 */
export const mapPresenceUsers = <T>(
  users: ReadonlyArray<PresenceUser>,
  mapUser: (user: PresenceUser) => T | null,
): T[] =>
  users.flatMap((user) => {
    try {
      const value = mapUser(user);
      return value === null ? [] : [value];
    } catch (error) {
      if (isIsolatablePresenceAnchorError(error)) {
        return [];
      }
      throw error;
    }
  });
