/**
 * Pure functions for cursor and selection operations
 */

import type {
  CursorPosition,
  PresenceSelection,
  PresenceUser,
} from "../types/presence";
import {
  markUserActivity,
  selectionReferencesBlock,
} from "../types/presence";
import type { PresenceState } from "../types/state";

/**
 * Update a user's cursor position (pure function) — marks activity
 */
export const updateUserCursor = (
  state: PresenceState,
  connectionId: string,
  cursor: CursorPosition | null,
  at: number = Date.now(),
): PresenceState => {
  const user = state.users.get(connectionId);
  if (user === undefined) {
    return state;
  }

  const updatedUser = markUserActivity(user, at, {
    cursor: cursor ?? undefined,
  });

  const newUsers = new Map(state.users);
  newUsers.set(connectionId, updatedUser);

  return { ...state, users: newUsers };
};

/**
 * Update a user's selection range (pure function) — marks activity
 */
export const updateUserSelection = (
  state: PresenceState,
  connectionId: string,
  selection: PresenceSelection | null,
  at: number = Date.now(),
): PresenceState => {
  const user = state.users.get(connectionId);
  if (user === undefined) {
    return state;
  }

  const updatedUser = markUserActivity(user, at, {
    selection: selection ?? undefined,
  });

  const newUsers = new Map(state.users);
  newUsers.set(connectionId, updatedUser);

  return { ...state, users: newUsers };
};

/**
 * Get all users with cursors in a specific block (pure function)
 */
export const getUsersInBlock = (
  state: PresenceState,
  blockId: string,
): ReadonlyArray<PresenceUser> =>
  Array.from(state.users.values()).filter(
    (user) => user.cursor?.blockId === blockId,
  );

/**
 * Get all users with selections in a specific block (pure function)
 */
export const getUsersSelectingBlock = (
  state: PresenceState,
  blockId: string,
): ReadonlyArray<PresenceUser> =>
  Array.from(state.users.values()).filter((user) =>
    selectionReferencesBlock(user.selection, blockId),
  );

/**
 * Get all cursors grouped by block (pure function)
 */
export const getCursorsByBlock = (
  state: PresenceState,
): ReadonlyMap<string, ReadonlyArray<PresenceUser>> => {
  const byBlock = new Map<string, PresenceUser[]>();

  for (const user of state.users.values()) {
    if (user.cursor?.blockId !== undefined) {
      const existing = byBlock.get(user.cursor.blockId) ?? [];
      byBlock.set(user.cursor.blockId, [...existing, user]);
    }
  }

  return byBlock;
};

/**
 * Check if any other user has a cursor in a block (pure function)
 */
export const hasOtherCursorsInBlock = (
  state: PresenceState,
  blockId: string,
  excludeConnectionId?: string,
): boolean =>
  Array.from(state.users.values()).some(
    (user) =>
      user.cursor?.blockId === blockId &&
      (excludeConnectionId === undefined ||
        user.connectionId !== excludeConnectionId),
  );

/**
 * Clear cursor for a user (pure function)
 */
export const clearUserCursor = (
  state: PresenceState,
  connectionId: string,
): PresenceState => updateUserCursor(state, connectionId, null);

/**
 * Clear selection for a user (pure function)
 */
export const clearUserSelection = (
  state: PresenceState,
  connectionId: string,
): PresenceState => updateUserSelection(state, connectionId, null);
