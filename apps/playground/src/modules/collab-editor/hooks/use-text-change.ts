import { useCallback, useEffect } from "react";
import type { RoomManager } from "../room-manager";
import { debounce } from "../utils";

/**
 * Hook for handling text changes in the collaborative editor
 */
export function useTextChange(
  roomManager: RoomManager | null,
  onTextUpdate?: (text: string) => void,
) {
  // Debounced text change handler to reduce events
 const handleTextChange = useCallback(
    debounce(async (value: string, source: "local" | "remote" = "local") => {
     if (!roomManager || source === "remote") return;

     const currentText = roomManager.getText();

      if (value === currentText) return; // No change

      // Determine operation type
      if (value.length > currentText.length) {
        // Insert operation
       const insertPos = findFirstDifference(currentText, value);
       const insertedText = value.slice(
         insertPos,
         insertPos + (value.length - currentText.length),
       );
        await roomManager.insert(insertPos, insertedText);
     } else if (value.length < currentText.length) {
       // Delete operation
       const deletePos = findFirstDifference(value, currentText);
       const deleteCount = currentText.length - value.length;
        await roomManager.delete(deletePos, deleteCount);
     } else {
       // Replace operation (same length, different content)
       const replacePos = findFirstDifference(currentText, value);
       if (replacePos !== -1) {
         const endPos = findLastDifference(currentText, value) + 1;
         const replacedText = value.slice(replacePos, endPos);
          await roomManager.replace(replacePos, endPos - replacePos, replacedText);
       }
     }
   }, 100),
    [],
  );

  // Subscribe to remote text changes
  useEffect(() => {
    if (!roomManager || !onTextUpdate) return;

    const originalHandler = roomManager.onContentChange;
    roomManager.onContentChange = () => {
      originalHandler?.();
      onTextUpdate(roomManager.getText());
    };

    return () => {
      roomManager.onContentChange = originalHandler;
    };
  }, [roomManager, onTextUpdate]);

  return { handleTextChange };
}

/**
 * Find the first position where two strings differ
 */
function findFirstDifference(str1: string, str2: string): number {
  const minLen = Math.min(str1.length, str2.length);
  for (let i = 0; i < minLen; i++) {
    if (str1[i] !== str2[i]) return i;
  }
  return minLen;
}

/**
 * Find the last position where two strings differ
 */
function findLastDifference(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  let i = 0;
  while (i < len1 && i < len2) {
    if (str1[len1 - 1 - i] !== str2[len2 - 1 - i]) {
      return len1 - 1 - i;
    }
    i++;
  }
  return Math.max(len1, len2) - 1 - i;
}
