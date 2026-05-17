/**
 * Best-effort diff fallback for callers that only have before/after strings
 * rather than an explicit `PositionOperation`. These helpers infer where a
 * single insert or delete happened by scanning from the start.
 *
 * They are not a full diff — they assume exactly one edit happened between
 * `oldText` and `newText` and bail out at the first divergence.
 */

/**
 * @deprecated Use `findChangedSpan` instead. This helper assumes exactly one
 * insert and can produce incorrect positions for replacements.
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

/**
 * @deprecated Use `findChangedSpan` instead. This helper assumes exactly one
 * delete and can produce incorrect positions for replacements.
 */
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

export type ChangedSpan = {
  /** Length of the common prefix shared by `oldText` and `newText`. */
  readonly prefix: number;
  /** Length of the common suffix shared by `oldText` and `newText`. */
  readonly suffix: number;
};

/**
 * Identify the changed span between `oldText` and `newText` by stripping the
 * longest common prefix and longest common suffix. Handles inserts, deletes,
 * and net-length-changing replacements in a single pass — unlike the
 * `find{Insert,Delete}Position` / `findDifferingRange` helpers above, which
 * each assume one specific shape of edit.
 *
 * Callers derive the edit from `{ prefix, suffix }`:
 *   - `deletedLength = oldText.length - prefix - suffix`
 *   - `insertedText  = newText.slice(prefix, newText.length - suffix)`
 *
 * Both can be zero (pure insert, pure delete, or no-op).
 *
 * Encoding convention: prefix is consumed greedily first, then suffix. So
 * equal strings return `{ prefix: len, suffix: 0 }` rather than the
 * symmetrically-valid `{ prefix: 0, suffix: len }`. Consumers that derive
 * `deletedLength` / `insertedText` from the result are unaffected.
 */
export const findChangedSpan = (
  oldText: string,
  newText: string,
): ChangedSpan => {
  const minLength = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < minLength && oldText[prefix] === newText[prefix]) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText[oldText.length - suffix - 1] ===
      newText[newText.length - suffix - 1]
  ) {
    suffix++;
  }

  return { prefix, suffix };
};

/**
 * @deprecated Use `findChangedSpan` instead. This helper assumes a
 * same-length-or-equivalent replacement shape and can produce incorrect
 * ranges for mixed-length edits.
 */
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
