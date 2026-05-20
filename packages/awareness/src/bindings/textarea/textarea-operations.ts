/**
 * Pure operation helpers for the textarea reference binding.
 *
 * `TextareaOperation` is a structural superset of `PositionOperation`:
 * delete ops are identical; insert ops add a `text` field so a batch is
 * self-sufficient (the binding can reconstruct the post-image without
 * the caller separately supplying the text). This trades a small extra
 * field for matching the `SurfaceBinding.applyRemoteOperations`
 * contract exactly — without it the binding would need an out-of-band
 * post-image text, which doesn't generalise to non-textarea bindings.
 *
 * Selection mapping helpers in `mapping/` only read `type`/`index`/
 * `length`, so a `TextareaOperation` is accepted anywhere a
 * `PositionOperation` is. The reverse requires enriching inserts via
 * `toTextareaOperationsFromTextChange`.
 */

import {
  type DeleteOperation,
  POSITION_OPERATION_TYPE,
  type PositionOperation,
} from "../../mapping/position-operation";
import { findChangedSpan } from "../../mapping/text-diff";

export type TextareaInsertOperation = {
  readonly type: typeof POSITION_OPERATION_TYPE.Insert;
  readonly index: number;
  readonly length: number;
  readonly text: string;
};

export type TextareaDeleteOperation = DeleteOperation;

export type TextareaOperation =
  | TextareaInsertOperation
  | TextareaDeleteOperation;

/**
 * Derive the textarea operation(s) implied by a value change.
 *
 * Returns an empty array for a no-op so callers can iterate uniformly
 * without a null check. When both delete and insert are present they
 * are emitted in delete-then-insert order; both share the same `index`
 * (the common prefix length), so swapping them would change their
 * meaning.
 */
export const computeTextareaOperations = (
  oldText: string,
  newText: string,
): readonly TextareaOperation[] => {
  if (oldText === newText) {
    return [];
  }

  const { prefix, suffix } = findChangedSpan(oldText, newText);
  const deletedLength = oldText.length - prefix - suffix;
  const insertedLength = newText.length - prefix - suffix;
  const operations: TextareaOperation[] = [];

  if (deletedLength > 0) {
    operations.push({
      type: POSITION_OPERATION_TYPE.Delete,
      index: prefix,
      length: deletedLength,
    });
  }

  if (insertedLength > 0) {
    operations.push({
      type: POSITION_OPERATION_TYPE.Insert,
      index: prefix,
      length: insertedLength,
      text: newText.slice(prefix, prefix + insertedLength),
    });
  }

  return operations;
};

/**
 * Enrich an index-only `PositionOperation` with the literal inserted
 * characters by sourcing them from the post-image text. Delete ops pass
 * through unchanged.
 *
 * Intended for callers that receive `PositionOperation` from a CRDT
 * engine (e.g. eg-walker's `applyRemoteEvent` result) and the
 * authoritative text snapshot after the op was applied. The inserted
 * text is `textAfter.slice(op.index, op.index + op.length)`.
 */
export const toTextareaOperation = (
  operation: PositionOperation,
  textAfter: string,
): TextareaOperation => {
  if (operation.type === POSITION_OPERATION_TYPE.Delete) {
    return operation;
  }
  return {
    type: POSITION_OPERATION_TYPE.Insert,
    index: operation.index,
    length: operation.length,
    text: textAfter.slice(operation.index, operation.index + operation.length),
  };
};

/**
 * Apply an ordered batch of textarea operations to a string, producing
 * the resulting string. Inserts carry their literal text; deletes are
 * applied by index/length.
 */
export const applyOperationsToText = (
  text: string,
  operations: readonly TextareaOperation[],
): string =>
  operations.reduce((current, operation) => {
    if (operation.type === POSITION_OPERATION_TYPE.Delete) {
      return (
        current.slice(0, operation.index) +
        current.slice(operation.index + operation.length)
      );
    }
    return (
      current.slice(0, operation.index) +
      operation.text +
      current.slice(operation.index)
    );
  }, text);
