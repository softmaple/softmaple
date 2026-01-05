import type { RoomManager } from "../room-manager";

/**
 * Determines what operation to perform and executes it
 */
export async function performTextOperation(
  roomManager: RoomManager,
  currentText: string,
  newValue: string,
): Promise<void> {
  if (newValue.length > currentText.length) {
    await performInsert(roomManager, currentText, newValue);
  } else if (newValue.length < currentText.length) {
    await performDelete(roomManager, currentText, newValue);
  } else {
    await performReplace(roomManager, currentText, newValue);
  }
}

/**
 * Performs an insert operation
 */
async function performInsert(
  roomManager: RoomManager,
  currentText: string,
  newValue: string,
): Promise<void> {
  const insertPos = findFirstDifference(currentText, newValue);
  const insertedText = newValue.slice(
    insertPos,
    insertPos + (newValue.length - currentText.length),
  );
  await roomManager.insert(insertPos, insertedText);
}

/**
 * Performs a delete operation
 */
async function performDelete(
  roomManager: RoomManager,
  currentText: string,
  newValue: string,
): Promise<void> {
  const deletePos = findFirstDifference(newValue, currentText);
  const deleteCount = currentText.length - newValue.length;
  await roomManager.delete(deletePos, deleteCount);
}

/**
 * Performs a replace operation
 */
async function performReplace(
  roomManager: RoomManager,
  currentText: string,
  newValue: string,
): Promise<void> {
  const replacePos = findFirstDifference(currentText, newValue);
  // If strings are identical, no replacement needed
  if (replacePos >= Math.min(currentText.length, newValue.length)) return;

  const diffIndex = findLastDifference(currentText, newValue);
  const endPos =
    diffIndex === -1
      ? Math.max(currentText.length, newValue.length)
      : diffIndex + 1;
  const replacedText = newValue.slice(replacePos, endPos);
  await roomManager.replace(replacePos, endPos - replacePos, replacedText);
}

/**
 * Find the first position where two strings differ
 */
export function findFirstDifference(str1: string, str2: string): number {
  const minLen = Math.min(str1.length, str2.length);
  for (let i = 0; i < minLen; i++) {
    if (str1[i] !== str2[i]) return i;
  }
  return minLen;
}

/**
 * Find the last position where two strings differ
 * @returns The index of the last differing character, or -1 if strings are identical
 */
export function findLastDifference(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const minLen = Math.min(len1, len2);

  // If strings are identical, return -1
  if (str1 === str2) {
    return -1;
  }

  // Scan from the end to find the last differing character
  for (let i = 0; i < minLen; i++) {
    if (str1[len1 - 1 - i] !== str2[len2 - 1 - i]) {
      // Return the index of the last differing character in str1
      return len1 - 1 - i;
    }
  }

  // If all compared characters match but lengths differ
  // return the last index of the longer string
  return Math.max(len1, len2) - 1;
}
