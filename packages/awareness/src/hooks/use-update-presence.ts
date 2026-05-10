/**
 * useUpdatePresence hook - Update current user's presence
 */

import { useCallback, useContext, useEffect, useRef } from "react";
import { PresenceContext } from "../providers/presence-context";
import type { CursorPosition, SelectionRange } from "../types/presence";

const PROVIDER_ERROR_MSG =
  "must be used within a PresenceProvider. " +
  "Wrap your component tree with <PresenceProvider adapter={adapter}>.";

const DEFAULT_CURSOR_THROTTLE_MS = 16;
const DEFAULT_TYPING_IDLE_MS = 1500;

/**
 * Hook to get the updatePresence function
 * @returns Function to update presence
 * @throws Error if used outside of PresenceProvider
 */
export const useUpdatePresence = () => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useUpdatePresence ${PROVIDER_ERROR_MSG}`);
  }
  return context.updatePresence;
};

/**
 * Hook to update cursor position. Trailing-edge throttle so high-frequency
 * mousemove streams collapse to one network update per `throttleMs` window.
 * Pass `throttleMs: 0` to opt out.
 * @throws Error if used outside of PresenceProvider
 */
export const useUpdateCursor = (
  throttleMs: number = DEFAULT_CURSOR_THROTTLE_MS,
) => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useUpdateCursor ${PROVIDER_ERROR_MSG}`);
  }
  const { updatePresence } = context;

  const lastSentAtRef = useRef(0);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trailingValueRef = useRef<CursorPosition | undefined>(undefined);

  useEffect(
    () => () => {
      if (trailingTimerRef.current !== null) {
        clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
      }
    },
    [],
  );

  return useCallback(
    (cursor: CursorPosition | undefined) => {
      if (throttleMs <= 0) {
        updatePresence({ cursor });
        return;
      }

      const now = Date.now();
      const elapsed = now - lastSentAtRef.current;

      if (elapsed >= throttleMs) {
        lastSentAtRef.current = now;
        if (trailingTimerRef.current !== null) {
          clearTimeout(trailingTimerRef.current);
          trailingTimerRef.current = null;
        }
        updatePresence({ cursor });
        return;
      }

      trailingValueRef.current = cursor;
      if (trailingTimerRef.current === null) {
        trailingTimerRef.current = setTimeout(() => {
          trailingTimerRef.current = null;
          lastSentAtRef.current = Date.now();
          updatePresence({ cursor: trailingValueRef.current });
        }, throttleMs - elapsed);
      }
    },
    [throttleMs, updatePresence],
  );
};

/**
 * Hook to update selection range
 * @returns Function to update selection range
 * @throws Error if used outside of PresenceProvider
 */
export const useUpdateSelection = () => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useUpdateSelection ${PROVIDER_ERROR_MSG}`);
  }
  const { updatePresence } = context;

  return useCallback(
    (selection: SelectionRange | undefined) => {
      updatePresence({ selection });
    },
    [updatePresence],
  );
};

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
