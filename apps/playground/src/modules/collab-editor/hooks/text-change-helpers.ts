import type { RoomManager } from "../room-manager";

/**
 * Determines what operation to perform and executes it
 */
export async function performTextOperation(
  roomManager: RoomManager,
  currentText: string,
  newValue: string,
): Promise<void> {
  const startDiff = findFirstDifference(currentText, newValue);
  if (startDiff === currentText.length && startDiff === newValue.length) {
    return; // No difference
  }

  // Find how many characters match from the end
  let endMatchCount = 0;
  while (
    endMatchCount < currentText.length - startDiff &&
    endMatchCount < newValue.length - startDiff &&
    currentText[currentText.length - 1 - endMatchCount] ===
      newValue[newValue.length - 1 - endMatchCount]
  ) {
    endMatchCount++;
  }

  const deleteLength = currentText.length - startDiff - endMatchCount;
  const insertText = newValue.slice(startDiff, newValue.length - endMatchCount);

  if (deleteLength > 0 && insertText.length > 0) {
    await roomManager.replace(startDiff, deleteLength, insertText);
  } else if (deleteLength > 0) {
    await roomManager.delete(startDiff, deleteLength);
  } else if (insertText.length > 0) {
    await roomManager.insert(startDiff, insertText);
  }
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
