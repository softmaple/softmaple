/**
 * useCursors hook - Convenience selector for rendering peer cursors.
 *
 * Returns only the other users (excluding self) that currently report a
 * cursor position, filtered to non-offline by default. This is the typical
 * input shape for rendering a `<LiveCursor>` layer.
 */

import { useContext, useMemo } from "react";
import { PresenceContext } from "../providers/presence-context";
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
  const { others } = context;

  return useMemo(() => {
    const result: PeerCursor[] = [];
    for (const user of others) {
      if (!includeOffline && user.status === "offline") continue;
      if (user.cursor === undefined) continue;
      if (blockId !== undefined && user.cursor.blockId !== blockId) continue;
      result.push({ user, cursor: user.cursor });
    }
    return result;
  }, [others, includeOffline, blockId]);
};
