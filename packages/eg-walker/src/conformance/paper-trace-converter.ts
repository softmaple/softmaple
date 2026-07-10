import { OPERATION_TYPE } from "../constants/operation-types";
import type { EventId, GraphEvent, Version } from "../types";
import {
  materializeScalarReferenceVersion,
  scalarReferenceFrontier,
} from "./scalar-reference-replay";

export interface AtomicPaperTrace {
  readonly endContent: string;
  readonly txns: ReadonlyArray<AtomicPaperTransaction>;
}

export interface AtomicPaperTransaction {
  readonly parents: ReadonlyArray<number>;
  readonly agent: number | string;
  readonly patches: ReadonlyArray<AtomicPaperPatch>;
  readonly _dtSpan?: readonly [number, number];
}

export type AtomicPaperPatch = readonly [
  index: number,
  deleteLength: number,
  insertedText: string,
];

export interface ConvertAtomicPaperTraceOptions {
  readonly validateFinalText?: boolean;
}

interface UnicodeOffsetState {
  readonly scalarLength: number;
  readonly nonBmpCodePointPositions: ReadonlyArray<number>;
}

export const convertPaperTraceToAtomicEvents = (
  dataset: string,
  trace: AtomicPaperTrace,
  options: ConvertAtomicPaperTraceOptions = {},
): GraphEvent[] => {
  const events: GraphEvent[] = [];
  const transactionVersions: Array<Version | undefined> = new Array(
    trace.txns.length,
  );
  const transactionUnicodeStates: Array<UnicodeOffsetState | undefined> =
    new Array(trace.txns.length);

  for (
    let transactionIndex = 0;
    transactionIndex < trace.txns.length;
    transactionIndex++
  ) {
    const transaction = trace.txns[transactionIndex];
    if (transaction === undefined) {
      throw new Error(`${dataset}: missing transaction ${transactionIndex}`);
    }

    let currentVersion = unionParentVersions(
      dataset,
      transactionIndex,
      trace.txns,
      transactionVersions,
    );
    let unicodeState = unicodeStateForParentVersion(
      currentVersion,
      transaction,
      transactionUnicodeStates,
      events,
    );
    let localVersion = transaction._dtSpan?.[0] ?? 0;
    let operationOffset = 0;

    for (
      let patchIndex = 0;
      patchIndex < transaction.patches.length;
      patchIndex++
    ) {
      const patch = transaction.patches[patchIndex];
      if (patch === undefined) {
        throw new Error(
          `${dataset}: transaction ${transactionIndex} missing patch ${patchIndex}`,
        );
      }
      const [index, deleteLength, insertedText] = patch;
      assertScalarRange(
        unicodeState,
        index,
        deleteLength,
        dataset,
        transactionIndex,
      );

      for (let deleteOffset = 0; deleteOffset < deleteLength; deleteOffset++) {
        const utf16Index = utf16IndexForScalarIndex(unicodeState, index);
        const utf16Length =
          utf16IndexForScalarIndex(unicodeState, index + 1) - utf16Index;
        const id = paperEventId(
          dataset,
          transactionIndex,
          patchIndex,
          "delete",
          deleteOffset,
          transaction._dtSpan === undefined ? undefined : localVersion,
        );
        events.push({
          id,
          parentVersion: new Set(currentVersion),
          operation: {
            type: OPERATION_TYPE.DELETE,
            index: utf16Index,
            length: utf16Length,
          },
          timestamp: transactionIndex + operationOffset,
        });
        unicodeState = deleteScalarRange(unicodeState, index, 1);
        currentVersion = new Set([id]);
        localVersion++;
        operationOffset++;
      }

      let insertOffset = 0;
      for (const character of insertedText) {
        const scalarIndex = index + insertOffset;
        const id = paperEventId(
          dataset,
          transactionIndex,
          patchIndex,
          "insert",
          insertOffset,
          transaction._dtSpan === undefined ? undefined : localVersion,
        );
        events.push({
          id,
          parentVersion: new Set(currentVersion),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: utf16IndexForScalarIndex(unicodeState, scalarIndex),
            text: character,
          },
          timestamp: transactionIndex + operationOffset,
        });
        unicodeState = insertScalar(unicodeState, scalarIndex, character);
        currentVersion = new Set([id]);
        localVersion++;
        operationOffset++;
        insertOffset++;
      }
    }

    const expectedEnd = transaction._dtSpan?.[1];
    if (expectedEnd !== undefined && localVersion !== expectedEnd) {
      throw new Error(
        `${dataset}: transaction ${transactionIndex} emitted through local version ${localVersion}, expected ${expectedEnd}`,
      );
    }
    transactionVersions[transactionIndex] = currentVersion;
    transactionUnicodeStates[transactionIndex] = unicodeState;
  }

  if (options.validateFinalText ?? true) {
    const actual = materializeScalarReferenceVersion(
      events,
      scalarReferenceFrontier(events),
    );
    if (actual !== trace.endContent) {
      throw new Error(
        `${dataset}: converted final text mismatch; expected ${JSON.stringify(trace.endContent)}, received ${JSON.stringify(actual)}`,
      );
    }
  }

  return events;
};

const unionParentVersions = (
  dataset: string,
  transactionIndex: number,
  transactions: ReadonlyArray<AtomicPaperTransaction>,
  transactionVersions: ReadonlyArray<Version | undefined>,
): Set<EventId> => {
  const result = new Set<EventId>();
  for (const parentIndex of transactions[transactionIndex]?.parents ?? []) {
    const parentVersion = transactionVersions[parentIndex];
    if (parentVersion === undefined) {
      throw new Error(
        `${dataset}: transaction ${transactionIndex} references unknown parent ${parentIndex}`,
      );
    }
    for (const eventId of parentVersion) {
      result.add(eventId);
    }
  }
  return result;
};

const unicodeStateForParentVersion = (
  version: Version,
  transaction: AtomicPaperTransaction,
  transactionUnicodeStates: ReadonlyArray<UnicodeOffsetState | undefined>,
  events: ReadonlyArray<GraphEvent>,
): UnicodeOffsetState => {
  if (transaction.parents.length === 0) {
    return { scalarLength: 0, nonBmpCodePointPositions: [] };
  }
  if (transaction.parents.length === 1) {
    const inherited = transactionUnicodeStates[transaction.parents[0]!];
    if (inherited !== undefined) {
      return {
        scalarLength: inherited.scalarLength,
        nonBmpCodePointPositions: [...inherited.nonBmpCodePointPositions],
      };
    }
  }
  return unicodeStateFromText(
    materializeScalarReferenceVersion(events, version),
  );
};

const unicodeStateFromText = (text: string): UnicodeOffsetState => ({
  scalarLength: Array.from(text).length,
  nonBmpCodePointPositions: Array.from(text).flatMap((character, index) =>
    character.length === 2 ? [index] : [],
  ),
});

const utf16IndexForScalarIndex = (
  state: UnicodeOffsetState,
  scalarIndex: number,
): number =>
  scalarIndex + lowerBound(state.nonBmpCodePointPositions, scalarIndex);

const insertScalar = (
  state: UnicodeOffsetState,
  index: number,
  character: string,
): UnicodeOffsetState => ({
  scalarLength: state.scalarLength + 1,
  nonBmpCodePointPositions: [
    ...state.nonBmpCodePointPositions
      .filter((position) => position < index)
      .map((position) => position),
    ...(character.length === 2 ? [index] : []),
    ...state.nonBmpCodePointPositions
      .filter((position) => position >= index)
      .map((position) => position + 1),
  ],
});

const deleteScalarRange = (
  state: UnicodeOffsetState,
  index: number,
  length: number,
): UnicodeOffsetState => {
  const end = index + length;
  return {
    scalarLength: state.scalarLength - length,
    nonBmpCodePointPositions: state.nonBmpCodePointPositions
      .filter((position) => position < index || position >= end)
      .map((position) => (position >= end ? position - length : position)),
  };
};

const assertScalarRange = (
  state: UnicodeOffsetState,
  index: number,
  length: number,
  dataset: string,
  transactionIndex: number,
): void => {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(
      `${dataset}: transaction ${transactionIndex} has invalid scalar index ${index}`,
    );
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(
      `${dataset}: transaction ${transactionIndex} has invalid scalar length ${length}`,
    );
  }
  if (index > state.scalarLength || length > state.scalarLength - index) {
    throw new Error(
      `${dataset}: transaction ${transactionIndex} scalar range ${index}..${index + length} exceeds document length ${state.scalarLength}`,
    );
  }
};

const lowerBound = (values: ReadonlyArray<number>, target: number): number => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((values[middle] ?? 0) < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const paperEventId = (
  dataset: string,
  transactionIndex: number,
  patchIndex: number,
  kind: "delete" | "insert",
  offset: number,
  localVersion: number | undefined,
): EventId =>
  localVersion === undefined
    ? `paper:${dataset}:txn:${transactionIndex}:patch:${patchIndex}:${kind}:${offset}`
    : `paper:${dataset}:lv:${localVersion}`;
