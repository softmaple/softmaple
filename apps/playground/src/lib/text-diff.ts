/**
 * Text diffing utilities for collaborative editing
 */

/**
 * Find where text was inserted by comparing old and new text
 * @param oldText - The original text
 * @param newText - The new text after insertion
 * @returns The position where text was inserted
 */
export const findInsertPosition = (
  oldText: string,
  newText: string,
): number => {
  for (let i = 0; i < Math.min(oldText.length, newText.length); i++) {
    if (oldText[i] !== newText[i]) {
      return i;
    }
  }
  return oldText.length;
};

/**
 * Find where text was deleted by comparing old and new text
 * @param oldText - The original text
 * @param newText - The new text after deletion
 * @returns The position where text was deleted
 */
export const findDeletePosition = (
  oldText: string,
  newText: string,
): number => {
  for (let i = 0; i < Math.min(oldText.length, newText.length); i++) {
    if (oldText[i] !== newText[i]) {
      return i;
    }
  }
  return newText.length;
};

/**
 * Find the range of differing characters between two strings of equal length
 * @param oldText - The original text
 * @param newText - The new text
 * @returns Object with start and end indices of the differing range
 */
export const findDifferingRange = (
  oldText: string,
  newText: string,
): { start: number; end: number } => {
  let start = 0;
  let end = oldText.length - 1;

  // Find first differing index from the start
  while (start < oldText.length && oldText[start] === newText[start]) {
    start++;
  }

  // Find last differing index from the end
  while (end >= start && oldText[end] === newText[end]) {
    end--;
  }

  return { start, end };
};
