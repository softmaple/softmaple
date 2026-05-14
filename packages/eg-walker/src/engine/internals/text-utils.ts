import { OPERATION_TYPE } from "../../constants/operation-types";
import type { ExternalOperation } from "../../types";

export const spliceText = (
  text: string,
  index: number,
  insertText: string,
): string => `${text.slice(0, index)}${insertText}${text.slice(index)}`;

export const deleteText = (
  text: string,
  index: number,
  length: number,
): string => `${text.slice(0, index)}${text.slice(index + length)}`;

/**
 * Split a string into JS UTF-16 code units, one per array slot. Unlike
 * `Array.from(text)` (which iterates code points and would coalesce a
 * surrogate pair into one entry), this preserves the public-API code-unit
 * indexing on which the CRDT items are keyed.
 *
 * Lone surrogates are intentionally **not** rejected here: by the time a
 * string reaches this helper it has already been validated at the public
 * boundary (`EgWalkerReplica.assertWellFormedUtf16` for local inserts and
 * `assertRemoteEventWellFormed` for remote events). Bypassing the engine
 * directly with an ill-formed string would still materialise lone
 * surrogates as standalone CRDT items, but the public API never reaches
 * this path with such input.
 */
export const stringCodeUnits = (text: string): string[] => text.split("");

/**
 * Coalesce a sequence of in-order effect-index deletes into the smallest list
 * of {index, length} operations that, applied in order, produces the same
 * deletes. Two consecutive deletes are contiguous when the second targets the
 * same effect index as the first (the next character shifted into the slot).
 */
export const coalesceDeleteRuns = (
  effectIndexes: ReadonlyArray<number>,
): ExternalOperation[] => {
  const runs: ExternalOperation[] = [];
  let runStart = -1;
  let runLength = 0;

  for (const index of effectIndexes) {
    if (runLength === 0) {
      runStart = index;
      runLength = 1;
      continue;
    }

    if (index === runStart) {
      runLength += 1;
      continue;
    }

    runs.push({
      type: OPERATION_TYPE.DELETE,
      index: runStart,
      length: runLength,
    });
    runStart = index;
    runLength = 1;
  }

  if (runLength > 0) {
    runs.push({
      type: OPERATION_TYPE.DELETE,
      index: runStart,
      length: runLength,
    });
  }

  return runs;
};
