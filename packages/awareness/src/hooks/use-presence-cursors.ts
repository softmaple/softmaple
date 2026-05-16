/**
 * usePeerCursors hook - Convenience selector for rendering peer cursors.
 *
 * Returns only the other users (excluding self) that currently report a
 * cursor position, filtered to non-offline by default. This is the typical
 * input shape for rendering a `<LiveCursor>` layer.
 */

import { useContext, useMemo } from "react";
import { PresenceContext } from "../providers/presence-context";
import type { PresenceResolver } from "../resolver";
import type { CursorPosition, PresenceUser } from "../types/presence";

const PROVIDER_ERROR_MSG =
  "must be used within a PresenceProvider. " +
  "Wrap your component tree with <PresenceProvider adapter={adapter}>.";

export interface PeerCursor {
  readonly user: PresenceUser;
  readonly cursor: CursorPosition;
}

export interface UsePeerCursorsOptions {
  /**
   * Include peers whose `status === "offline"`. Defaults to `false` —
   * offline peers' stale cursors are typically noise.
   */
  readonly includeOffline?: boolean;
  /**
   * Restrict to peers whose cursor `blockId` matches. When omitted, peers
   * from any block are returned.
   */
  readonly blockId?: string;
}

const hasSelectionAnchor = (user: PresenceUser): boolean =>
  user.selection?.fromAnchor !== undefined ||
  user.selection?.toAnchor !== undefined;

const resolvePeerForRendering = (
  user: PresenceUser,
  resolver: PresenceResolver | undefined,
): PresenceUser | null => {
  if (resolver === undefined) return user;

  let cursor = user.cursor;
  let selection = user.selection;

  // Anchors win over offsets when a resolver is configured. If the resolver
  // returns null the anchor no longer points at valid content and the peer is
  // dropped from rendering.
  if (cursor?.anchor !== undefined && resolver.resolveCursor !== undefined) {
    cursor = resolver.resolveCursor(cursor, user.userId) ?? undefined;
    if (cursor === undefined) return null;
  }

  if (
    selection !== undefined &&
    hasSelectionAnchor(user) &&
    resolver.resolveSelection !== undefined
  ) {
    selection = resolver.resolveSelection(selection, user.userId) ?? undefined;
    if (selection === undefined) return null;
  }

  if (cursor === user.cursor && selection === user.selection) return user;
  return { ...user, cursor, selection };
};

/**
 * Hook to access peer cursors as `{ user, cursor }` pairs.
 *
 * @example
 * ```tsx
 * const cursors = usePeerCursors();
 * return cursors.map(({ user, cursor }) => (
 *   <LiveCursor
 *     key={user.userId}
 *     user={user}
 *     point={blockOffsetToPoint(cursor.blockId, cursor.offset)}
 *   />
 * ));
 * ```
 *
 * @throws Error if used outside of PresenceProvider
 */
export const usePeerCursors = (
  options: UsePeerCursorsOptions = {},
): ReadonlyArray<PeerCursor> => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`usePeerCursors ${PROVIDER_ERROR_MSG}`);
  }
  const { includeOffline = false, blockId } = options;
  const { others, resolver } = context;

  return useMemo(() => {
    const result: PeerCursor[] = [];
    for (const user of others) {
      if (!includeOffline && user.status === "offline") continue;
      const resolvedUser = resolvePeerForRendering(user, resolver);
      if (resolvedUser?.cursor === undefined) continue;
      if (blockId !== undefined && resolvedUser.cursor.blockId !== blockId) {
        continue;
      }
      result.push({ user: resolvedUser, cursor: resolvedUser.cursor });
    }
    return result;
  }, [others, includeOffline, blockId, resolver]);
};
