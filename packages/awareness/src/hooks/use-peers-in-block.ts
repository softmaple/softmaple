/**
 * usePeersInBlock hook - Filtered view of who is editing a specific block.
 *
 * Returns the subset of peers whose cursor or selection currently lives in
 * the provided `blockId`. This is the underlying selector used by
 * `<BlockActivityIndicator>`, exposed as a hook so callers can render
 * custom UI (e.g. inline avatars next to each block heading).
 */

import { useContext, useMemo } from "react";
import { PresenceContext } from "../providers/presence-context";
import { applyResolver } from "../state/resolve-peer";
import type { PresenceUser } from "../types/presence";

const PROVIDER_ERROR_MSG =
  "must be used within a PresenceProvider. " +
  "Wrap your component tree with <PresenceProvider adapter={adapter}>.";

export interface UsePeersInBlockOptions {
  /**
   * Include the current user. Defaults to `false` — typical UIs don't show
   * yourself in your own "who's here" indicator.
   */
  readonly includeSelf?: boolean;
  /**
   * Include peers whose `status === "offline"`. Defaults to `false`.
   */
  readonly includeOffline?: boolean;
}

const isUserInBlock = (user: PresenceUser, blockId: string): boolean =>
  user.cursor?.blockId === blockId || user.selection?.blockId === blockId;

/**
 * Hook returning peers currently editing the given `blockId`.
 *
 * @example
 * ```tsx
 * const peers = usePeersInBlock("paragraph-3");
 * return peers.map((user) => <PresenceAvatar key={user.userId} user={user} size="sm" />);
 * ```
 *
 * @throws Error if used outside of PresenceProvider
 */
export const usePeersInBlock = (
  blockId: string,
  options: UsePeersInBlockOptions = {},
): ReadonlyArray<PresenceUser> => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`usePeersInBlock ${PROVIDER_ERROR_MSG}`);
  }
  const { includeSelf = false, includeOffline = false } = options;
  const { others, presence, self, resolver } = context;
  const selfId = self?.userId ?? null;

  return useMemo(() => {
    // `others` is already resolver-applied at the provider. For the
    // `includeSelf` branch we walk `presence` directly, so apply the resolver
    // here too — but never to self, which is broadcast and not resolved.
    const source: ReadonlyArray<PresenceUser> = includeSelf
      ? Array.from(presence.values()).map((user) =>
          user.userId === selfId ? user : applyResolver(user, resolver),
        )
      : others;
    return source.filter((user) => {
      if (!includeOffline && user.status === "offline") return false;
      return isUserInBlock(user, blockId);
    });
  }, [
    blockId,
    includeOffline,
    includeSelf,
    others,
    presence,
    selfId,
    resolver,
  ]);
};
