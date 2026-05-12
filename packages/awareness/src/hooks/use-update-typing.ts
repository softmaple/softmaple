/**
 * useUpdateTyping hook - Update current user's typing status with auto-stop on idle.
 */

import { useCallback, useContext, useEffect, useRef } from "react";
import { PresenceContext } from "../providers/presence-context";

const PROVIDER_ERROR_MSG =
  "must be used within a PresenceProvider. " +
  "Wrap your component tree with <PresenceProvider adapter={adapter}>.";

const DEFAULT_TYPING_IDLE_MS = 1500;

/**
 * Hook to update typing status with auto-stop on idle.
 *
 * Calling with `true` immediately sends `isTyping: true` (only on transition
 * — repeated true calls within the idle window are collapsed) and arms an
 * idle timer that sends `isTyping: false` after `idleMs` of no further
 * `true` calls. Calling with `false` cancels the timer and sends `false`
 * immediately. Pass `idleMs: 0` to opt out of auto-stop.
 *
 * @throws Error if used outside of PresenceProvider
 */
export const useUpdateTyping = (idleMs: number = DEFAULT_TYPING_IDLE_MS) => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useUpdateTyping ${PROVIDER_ERROR_MSG}`);
  }
  const { self, updatePresence } = context;
  const selfMetaRef = useRef(self?.meta);
  selfMetaRef.current = self?.meta;

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<boolean | null>(null);

  const sendTyping = useCallback(
    (isTyping: boolean) => {
      lastSentRef.current = isTyping;
      updatePresence({
        meta: { ...selfMetaRef.current, isTyping },
      });
    },
    [updatePresence],
  );

  useEffect(
    () => () => {
      if (idleTimerRef.current !== null) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    },
    [],
  );

  return useCallback(
    (isTyping: boolean) => {
      if (idleTimerRef.current !== null) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }

      if (!isTyping) {
        if (lastSentRef.current !== false) {
          sendTyping(false);
        }
        return;
      }

      if (lastSentRef.current !== true) {
        sendTyping(true);
      }

      if (idleMs > 0) {
        idleTimerRef.current = setTimeout(() => {
          idleTimerRef.current = null;
          sendTyping(false);
        }, idleMs);
      }
    },
    [idleMs, sendTyping],
  );
};
