/**
 * Best-effort diff fallback for callers that only have before/after strings
 * rather than an explicit `PositionOperation`. These helpers infer where a
 * single insert or delete happened by scanning from the start.
 *
 * They are not a full diff — they assume exactly one edit happened between
 * `oldText` and `newText` and bail out at the first divergence.
 */

export const findInsertPosition = (
  oldText: string,
  newText: string,
): number => {
  const min = Math.min(oldText.length, newText.length);
  for (let i = 0; i < min; i++) {
    if (oldText[i] !== newText[i]) {
      return i;
    }
  }
  return oldText.length;
};

export const findDeletePosition = (
  oldText: string,
  newText: string,
): number => {
  const min = Math.min(oldText.length, newText.length);
  for (let i = 0; i < min; i++) {
    if (oldText[i] !== newText[i]) {
      return i;
    }
  }
  return newText.length;
};

export const findDifferingRange = (
  oldText: string,
  newText: string,
): { start: number; end: number } => {
  let start = 0;
  let endOld = oldText.length - 1;
  let endNew = newText.length - 1;

  while (start < oldText.length && oldText[start] === newText[start]) {
    start++;
  }

  // Track separate end pointers so a different-length newText doesn't drag
  // oldText's end pointer past a real divergence (e.g. shared "de" suffix
  // in "abcde" / "abXYZde" lives at different indices in each string).
  while (
    endOld >= start &&
    endNew >= start &&
    oldText[endOld] === newText[endNew]
  ) {
    endOld--;
    endNew--;
  }

  return { start, end: endOld };
};
