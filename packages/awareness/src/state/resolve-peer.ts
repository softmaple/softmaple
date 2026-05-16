/**
 * Apply a PresenceResolver to a peer for rendering.
 *
 * Anchored cursor / selection fields are resolved against the local document
 * via the consumer-supplied resolver. If a resolver returns null for a field,
 * that field is cleared on the returned user (peer stays in the roster, just
 * without that field). Non-anchored fields and pointer are left untouched.
 *
 * Self should be filtered out before calling this — self is broadcast, not
 * resolved.
 */

import type { PresenceResolver } from "../resolver";
import type { PresenceUser, SelectionRange } from "../types/presence";

const hasSelectionAnchor = (selection: SelectionRange): boolean =>
  selection.fromAnchor !== undefined || selection.toAnchor !== undefined;

export const applyResolver = (
  user: PresenceUser,
  resolver: PresenceResolver | undefined,
): PresenceUser => {
  if (resolver === undefined) return user;

  let cursor = user.cursor;
  let selection = user.selection;

  if (cursor?.anchor !== undefined && resolver.resolveCursor !== undefined) {
    cursor = resolver.resolveCursor(cursor, user.userId) ?? undefined;
  }

  if (
    selection !== undefined &&
    hasSelectionAnchor(selection) &&
    resolver.resolveSelection !== undefined
  ) {
    selection = resolver.resolveSelection(selection, user.userId) ?? undefined;
  }

  if (cursor === user.cursor && selection === user.selection) return user;
  return { ...user, cursor, selection };
};
