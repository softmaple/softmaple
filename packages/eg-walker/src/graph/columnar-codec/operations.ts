import { OPERATION_TYPE } from "../../constants/operation-types";
import type { ExternalOperation, GraphEvent } from "../../types";
import { BinaryReader, BinaryWriter } from "../internals/binary-io";
import type {
  ColumnarEventGraph,
  OperationRun,
  PartialOperationRun,
} from "./types";
import { operationTextLength } from "./types";

export const encodeOperationRuns = (
  events: ReadonlyArray<GraphEvent>,
): OperationRun[] => {
  const runs: OperationRun[] = [];

  for (const [eventOffset, event] of events.entries()) {
    const previous = runs[runs.length - 1];
    const textLength = operationTextLength(event.operation);
    const canExtend =
      previous &&
      previous.type === event.operation.type &&
      previous.startEventOffset + previous.length === eventOffset;

    if (canExtend) {
      runs[runs.length - 1] = {
        ...previous,
        length: previous.length + 1,
        textLength:
          previous.textLength !== undefined
            ? previous.textLength + textLength
            : undefined,
      };
    } else {
      runs.push({
        type: event.operation.type,
        startIndex: event.operation.index,
        startEventOffset: eventOffset,
        length: 1,
        textLength:
          event.operation.type === OPERATION_TYPE.INSERT
            ? textLength
            : undefined,
      });
    }
  }

  return runs;
};

/**
 * Binary form of an operation run is just `(type, length)`. The other
 * fields on the in-memory `OperationRun` (`startIndex`, `startEventOffset`,
 * `textLength`) are all derivable from the other columns and are
 * reconstructed by {@link readOperationRuns} using `operationIndexes` and
 * `operationLengths`.
 */
export const writeOperationRuns = (
  writer: BinaryWriter,
  runs: ReadonlyArray<OperationRun>,
): void => {
  writer.writeVarint(runs.length);
  for (const run of runs) {
    writer.writeVarint(run.type === OPERATION_TYPE.INSERT ? 1 : 2);
    writer.writeVarint(run.length);
  }
};

export const readOperationRuns = (
  reader: BinaryReader,
): PartialOperationRun[] => {
  const length = reader.readVarint();
  const runs: PartialOperationRun[] = [];
  let cursor = 0;

  for (let i = 0; i < length; i++) {
    const marker = reader.readVarint();
    if (marker !== 1 && marker !== 2) {
      throw new Error(`Unknown operation type marker ${marker} at run ${i}`);
    }
    const type = marker === 1 ? OPERATION_TYPE.INSERT : OPERATION_TYPE.DELETE;
    const runLength = reader.readVarint();
    runs.push({
      type,
      startEventOffset: cursor,
      length: runLength,
    });
    cursor += runLength;
  }

  return runs;
};

export const decodeOperations = (
  encoded: ColumnarEventGraph,
  insertedContent: string,
  eventCount: number,
): ExternalOperation[] => {
  const operations: ExternalOperation[] = [];
  let contentOffset = 0;
  let runOffset = 0;

  for (let eventOffset = 0; eventOffset < eventCount; eventOffset++) {
    while (
      runOffset < encoded.operationRuns.length &&
      eventOffset >=
        (encoded.operationRuns[runOffset]?.startEventOffset ?? 0) +
          (encoded.operationRuns[runOffset]?.length ?? 0)
    ) {
      runOffset++;
    }

    const run = encoded.operationRuns[runOffset];
    if (!run) {
      throw new Error(`Missing operation run for event offset ${eventOffset}`);
    }
    if (
      eventOffset < run.startEventOffset ||
      eventOffset >= run.startEventOffset + run.length
    ) {
      throw new Error(
        `Operation run ${runOffset} does not cover event offset ${eventOffset}`,
      );
    }

    const index = encoded.operationIndexes[eventOffset] ?? run.startIndex;
    const length = encoded.operationLengths[eventOffset] ?? 0;
    const textLength = encoded.textLengths[eventOffset] ?? 0;

    if (run.type === OPERATION_TYPE.INSERT) {
      const text = insertedContent.slice(
        contentOffset,
        contentOffset + textLength,
      );
      operations[eventOffset] = {
        type: OPERATION_TYPE.INSERT,
        index,
        text,
      };
      contentOffset += textLength;
    } else {
      operations[eventOffset] = {
        type: OPERATION_TYPE.DELETE,
        index,
        length,
      };
    }
  }

  return operations;
};
