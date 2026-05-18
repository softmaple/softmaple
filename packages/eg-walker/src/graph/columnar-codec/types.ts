import { OPERATION_TYPE } from "../../constants/operation-types";
import type { EventId, ExternalOperation } from "../../types";

export interface OperationRun {
  readonly type: ExternalOperation["type"];
  readonly startIndex: number;
  readonly startEventOffset: number;
  readonly length: number;
  readonly textLength?: number;
}

export interface IdRun {
  readonly replicaId: string;
  readonly startSequence: number;
  readonly startEventOffset: number;
  readonly length: number;
  readonly custom?: boolean;
}

export interface ParentOverride {
  readonly eventOffset: number;
  readonly parents: ReadonlyArray<EventId>;
}

export interface ColumnarEventGraph {
  readonly version: ReadonlyArray<EventId>;
  readonly operationRuns: ReadonlyArray<OperationRun>;
  readonly operationIndexes: ReadonlyArray<number>;
  readonly operationLengths: ReadonlyArray<number>;
  readonly textLengths: ReadonlyArray<number>;
  readonly insertedContent: string;
  readonly parentOverrides: ReadonlyArray<ParentOverride>;
  readonly idRuns: ReadonlyArray<IdRun>;
  readonly timestamps: ReadonlyArray<number>;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Partial operation run as read from the binary wire: only `type`,
 * `startEventOffset` (the prefix sum of run lengths), and `length` are
 * available. `startIndex` and `textLength` are filled in by
 * {@link finalizeOperationRuns} once `operationIndexes` and
 * `operationLengths` have been read.
 */
export type PartialOperationRun = Omit<
  OperationRun,
  "startIndex" | "textLength"
>;

export const operationTextLength = (operation: ExternalOperation): number =>
  operation.type === OPERATION_TYPE.INSERT ? operation.text.length : 0;

export const operationLength = (operation: ExternalOperation): number =>
  operation.type === OPERATION_TYPE.INSERT
    ? operation.text.length
    : operation.length;

/**
 * Reconstruct the per-event `textLengths` column from `operationRuns` (which
 * carry the per-run type) and `operationLengths` (which equal text length for
 * INSERTs and delete length for DELETEs). EGW3 omits `textLengths` from the
 * binary wire because it's fully derivable from those two columns. Internal
 * helper invoked only from {@link ColumnarEventGraphCodec.decodeBinary},
 * where `operationLengths.length` is the total event count and every
 * `startEventOffset + offset` index is guaranteed to be in range.
 */
export const reconstructTextLengths = (
  operationRuns: ReadonlyArray<OperationRun>,
  operationLengths: ReadonlyArray<number>,
): number[] => {
  const textLengths: number[] = new Array<number>(operationLengths.length).fill(
    0,
  );
  for (const run of operationRuns) {
    if (run.type !== OPERATION_TYPE.INSERT) {
      continue;
    }
    for (let offset = 0; offset < run.length; offset++) {
      textLengths[run.startEventOffset + offset] =
        operationLengths[run.startEventOffset + offset]!;
    }
  }
  return textLengths;
};

/**
 * Promote the partial runs from {@link readOperationRuns} into full
 * {@link OperationRun} values. `startIndex` is taken from `operationIndexes`
 * at the run's first event offset; `textLength` is the sum of
 * `operationLengths` over the run's events (for INSERT runs only).
 */
export const finalizeOperationRuns = (
  runs: ReadonlyArray<PartialOperationRun>,
  operationIndexes: ReadonlyArray<number>,
  operationLengths: ReadonlyArray<number>,
): OperationRun[] =>
  runs.map((run) => {
    const startIndex = operationIndexes[run.startEventOffset]!;
    if (run.type !== OPERATION_TYPE.INSERT) {
      return { ...run, startIndex, textLength: undefined };
    }
    let textLength = 0;
    for (let offset = 0; offset < run.length; offset++) {
      textLength += operationLengths[run.startEventOffset + offset]!;
    }
    return { ...run, startIndex, textLength };
  });
