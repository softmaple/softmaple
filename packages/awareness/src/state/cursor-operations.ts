/**
 * Pure functions for cursor and selection operations
 */

import type {
  CursorPosition,
  PresenceSelection,
  PresenceUser,
} from "../types/presence";
import {
  selectionReferencesBlock,
  updatePresenceUser,
} from "../types/presence";
import type { PresenceState } from "../types/state";

/**
 * Update a user's cursor position (pure function)
 */
export const updateUserCursor = (
  state: PresenceState,
  userId: string,
  cursor: CursorPosition | null,
): PresenceState => {
  const user = state.users.get(userId);
  if (user === undefined) {
    return state;
  }

  const updatedUser = updatePresenceUser(user, {
    cursor: cursor ?? undefined,
    lastActiveAt: Date.now(),
  });

  const newUsers = new Map(state.users);
  newUsers.set(userId, updatedUser);

  return { ...state, users: newUsers };
};

/**
 * Update a user's selection range (pure function)
 */
export const updateUserSelection = (
  state: PresenceState,
  userId: string,
  selection: PresenceSelection | null,
): PresenceState => {
  const user = state.users.get(userId);
  if (user === undefined) {
    return state;
  }

  const updatedUser = updatePresenceUser(user, {
    selection: selection ?? undefined,
    lastActiveAt: Date.now(),
  });

  const newUsers = new Map(state.users);
  newUsers.set(userId, updatedUser);

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
  excludeUserId?: string,
): boolean =>
  Array.from(state.users.values()).some(
    (user) =>
      user.cursor?.blockId === blockId &&
      (excludeUserId === undefined || user.userId !== excludeUserId),
  );

/**
 * Clear cursor for a user (pure function)
 */
export const clearUserCursor = (
  state: PresenceState,
  userId: string,
): PresenceState => updateUserCursor(state, userId, null);

/**
 * Clear selection for a user (pure function)
 */
export const clearUserSelection = (
  state: PresenceState,
  userId: string,
): PresenceState => updateUserSelection(state, userId, null);
