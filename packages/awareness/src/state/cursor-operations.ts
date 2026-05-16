/**
 * Pure functions for cursor and selection operations
 */

import type { PositionMapper } from "../resolver";
import type {
  CursorPosition,
  PointerPosition,
  PresenceUser,
  SelectionRange,
} from "../types/presence";
import { updatePresenceUser } from "../types/presence";
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
  selection: SelectionRange | null,
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
 * Update a user's pointer position (pure function)
 */
export const updateUserPointer = (
  state: PresenceState,
  userId: string,
  pointer: PointerPosition | null,
): PresenceState => {
  const user = state.users.get(userId);
  if (user === undefined) {
    return state;
  }

  const updatedUser = updatePresenceUser(user, {
    pointer: pointer ?? undefined,
    lastActiveAt: Date.now(),
  });

  const newUsers = new Map(state.users);
  newUsers.set(userId, updatedUser);

  return { ...state, users: newUsers };
};

const hasSelectionAnchor = (selection: SelectionRange): boolean =>
  selection.fromAnchor !== undefined || selection.toAnchor !== undefined;

const remapUserPositions = (
  user: PresenceUser,
  mapper: PositionMapper,
): PresenceUser => {
  let cursor = user.cursor;
  let selection = user.selection;

  if (cursor !== undefined && cursor.anchor === undefined) {
    const mapped = mapper.mapPosition({
      blockId: cursor.blockId,
      offset: cursor.offset,
    });
    cursor =
      mapped === null
        ? undefined
        : { ...cursor, blockId: mapped.blockId, offset: mapped.offset };
  }

  if (selection !== undefined && !hasSelectionAnchor(selection)) {
    const mappedFrom = mapper.mapPosition({
      blockId: selection.blockId,
      offset: selection.from,
    });
    const mappedTo = mapper.mapPosition({
      blockId: selection.blockId,
      offset: selection.to,
    });
    selection =
      mappedFrom === null || mappedTo === null
        ? undefined
        : {
            ...selection,
            blockId: mappedFrom.blockId,
            from: mappedFrom.offset,
            to: mappedTo.offset,
          };
  }

  if (cursor === user.cursor && selection === user.selection) {
    return user;
  }

  return {
    ...user,
    cursor,
    selection,
  };
};

/**
 * Map-level remap of remote peers' offset-only cursors/selections through a
 * consumer-supplied mapper. Returns the input reference unchanged when no
 * peer needed remapping. Skip rules match `remapRemotePositions`.
 */
export const remapRemoteUsers = (
  users: ReadonlyMap<string, PresenceUser>,
  selfId: string | null,
  mapper: PositionMapper,
): ReadonlyMap<string, PresenceUser> => {
  let next: Map<string, PresenceUser> | null = null;

  for (const [userId, user] of users) {
    if (userId === selfId) continue;

    const remapped = remapUserPositions(user, mapper);
    if (remapped !== user) {
      if (next === null) next = new Map(users);
      next.set(userId, remapped);
    }
  }

  return next ?? users;
};

/**
 * Remaps remote peers' offset-only cursors/selections through a consumer-
 * supplied mapper after the local document changes. Skipped for:
 *   - self (state.selfId) — self is broadcast, not remapped
 *   - cursors/selections that carry an anchor — those resolve at render
 *   - pointer — different coordinate space, never transformed by edits
 * This is local rendering state; do not forward to the adapter.
 */
export const remapRemotePositions = (
  state: PresenceState,
  mapper: PositionMapper,
): PresenceState => {
  let newUsers: Map<string, PresenceUser> | null = null;

  for (const [userId, user] of state.users) {
    if (userId === state.selfId) continue;

    const remapped = remapUserPositions(user, mapper);
    if (remapped !== user) {
      if (newUsers === null) newUsers = new Map(state.users);
      newUsers.set(userId, remapped);
    }
  }

  return newUsers === null ? state : { ...state, users: newUsers };
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
  Array.from(state.users.values()).filter(
    (user) => user.selection?.blockId === blockId,
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

/**
 * Clear pointer for a user (pure function)
 */
export const clearUserPointer = (
  state: PresenceState,
  userId: string,
): PresenceState => updateUserPointer(state, userId, null);
