/**
 * useRemapRemotePositions hook - Remap remote cursors/selections locally
 * after the local document changes.
 */

import { useContext } from "react";
import { PresenceContext } from "../providers/presence-context";
import type { PositionMapper } from "../resolver";

const PROVIDER_ERROR_MSG =
  "must be used within a PresenceProvider. " +
  "Wrap your component tree with <PresenceProvider adapter={adapter}>.";

/**
 * Returns a local-only remap callback. Consumers call it from their editor's
 * document-change listener for offset-only remote positions.
 *
 * @throws Error if used outside of PresenceProvider
 */
export const useRemapRemotePositions = (): ((
  mapper: PositionMapper,
) => void) => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useRemapRemotePositions ${PROVIDER_ERROR_MSG}`);
  }
  return context.remapRemotePositions;
};
