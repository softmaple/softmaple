import { OPERATION_TYPE } from "../constants/operation-types";
import type { EventId, GraphEvent, Version } from "../types";
import { ScalarReferenceSession } from "./scalar-reference-replay";

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
  readonly maxEvents?: number;
}

/**
 * Field-oriented destination for atomic paper events.
 *
 * Keeping the destination field-oriented lets benchmark importers transfer
 * each event directly into owned columnar or batch storage instead of first
 * allocating a public {@link GraphEvent} wrapper.
 */
export interface AtomicPaperEventSink {
  appendInsert(
    id: EventId,
    parentVersion: Iterable<EventId>,
    index: number,
    text: string,
    timestamp: number,
  ): void;

  appendDelete(
    id: EventId,
    parentVersion: Iterable<EventId>,
    index: number,
    length: number,
    timestamp: number,
  ): void;
}

export interface AtomicPaperTraceConversionSummary {
  readonly eventCount: number;
  readonly frontier: ReadonlySet<EventId>;
  /** True when `maxEvents` stopped conversion, including at an exact bound. */
  readonly limited: boolean;
}

interface AtomicPaperEventEmitter {
  appendInsert(
    id: EventId,
    parentVersion: Iterable<EventId>,
    index: number,
    text: string,
    timestamp: number,
  ): GraphEvent | undefined;

  appendDelete(
    id: EventId,
    parentVersion: Iterable<EventId>,
    index: number,
    length: number,
    timestamp: number,
  ): GraphEvent | undefined;
}

interface UnicodeOffsetState {
  readonly scalarLength: number;
  readonly nonBmpCodePointPositions: ReadonlyArray<number>;
}

const EMPTY_NON_BMP_POSITIONS: ReadonlyArray<number> = [];

export const convertPaperTraceToAtomicEvents = (
  dataset: string,
  trace: AtomicPaperTrace,
  options: ConvertAtomicPaperTraceOptions = {},
): GraphEvent[] => {
  const events: GraphEvent[] = [];
  runPaperTraceAtomicConversion(
    dataset,
    trace,
    {
      appendInsert: (id, parentVersion, index, text, timestamp) => {
        const event: GraphEvent = {
          id,
          parentVersion: new Set(parentVersion),
          operation: { type: OPERATION_TYPE.INSERT, index, text },
          timestamp,
        };
        events.push(event);
        return event;
      },
      appendDelete: (id, parentVersion, index, length, timestamp) => {
        const event: GraphEvent = {
          id,
          parentVersion: new Set(parentVersion),
          operation: { type: OPERATION_TYPE.DELETE, index, length },
          timestamp,
        };
        events.push(event);
        return event;
      },
    },
    options,
  );
  return events;
};

/**
 * Stream operation-granularity paper events into a field-oriented sink.
 *
 * The sink is called synchronously in trace/topological order. Benchmark
 * callers normally disable final-text validation; in that mode the common
 * BMP trace path allocates no intermediate `GraphEvent` values.
 */
export const convertPaperTraceToAtomicSink = (
  dataset: string,
  trace: AtomicPaperTrace,
  sink: AtomicPaperEventSink,
  options: ConvertAtomicPaperTraceOptions = {},
): AtomicPaperTraceConversionSummary =>
  runPaperTraceAtomicConversion(
    dataset,
    trace,
    {
      appendInsert: (id, parentVersion, index, text, timestamp) => {
        sink.appendInsert(id, parentVersion, index, text, timestamp);
        return undefined;
      },
      appendDelete: (id, parentVersion, index, length, timestamp) => {
        sink.appendDelete(id, parentVersion, index, length, timestamp);
        return undefined;
      },
    },
    options,
  );

const runPaperTraceAtomicConversion = (
  dataset: string,
  trace: AtomicPaperTrace,
  sink: AtomicPaperEventEmitter,
  options: ConvertAtomicPaperTraceOptions,
): AtomicPaperTraceConversionSummary => {
  assertValidMaxEvents(options.maxEvents);
  const transactionVersions: Array<Version | undefined> = new Array(
    trace.txns.length,
  );
  const transactionUnicodeStates: Array<UnicodeOffsetState | undefined> =
    new Array(trace.txns.length);
  const nextSequenceByAgent = new Map<string, number>();
  const validateFinalText = options.validateFinalText ?? true;
  const referenceSession = needsScalarReferenceSession(trace, validateFinalText)
    ? new ScalarReferenceSession()
    : undefined;
  const frontier = new Set<EventId>();
  let eventCount = 0;

  for (
    let transactionIndex = 0;
    transactionIndex < trace.txns.length;
    transactionIndex++
  ) {
    const transaction = trace.txns[transactionIndex];
    if (transaction === undefined) {
      throw new Error(`${dataset}: missing transaction ${transactionIndex}`);
    }

    const currentVersion = unionParentVersions(
      dataset,
      transactionIndex,
      trace.txns,
      transactionVersions,
    );
    let unicodeState = unicodeStateForParentVersion(
      currentVersion,
      transaction,
      transactionUnicodeStates,
      referenceSession,
    );
    const agentKey = paperAgentKey(transaction.agent);
    let agentSequence = nextSequenceByAgent.get(agentKey) ?? 0;
    let traceVersion = transaction._dtSpan?.[0] ?? 0;
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
        const id = paperEventId(dataset, agentKey, agentSequence++);
        const timestamp = transactionIndex + operationOffset;
        const emittedEvent = sink.appendDelete(
          id,
          currentVersion,
          utf16Index,
          utf16Length,
          timestamp,
        );
        referenceSession?.applyEvent(
          emittedEvent ?? {
            id,
            parentVersion: new Set(currentVersion),
            operation: {
              type: OPERATION_TYPE.DELETE,
              index: utf16Index,
              length: utf16Length,
            },
            timestamp,
          },
        );
        updateFrontier(frontier, id, currentVersion);
        eventCount++;
        if (eventCount === options.maxEvents) {
          return { eventCount, frontier, limited: true };
        }
        unicodeState = deleteScalarRange(unicodeState, index, 1);
        replaceVersionWithEvent(currentVersion, id);
        traceVersion++;
        operationOffset++;
      }

      let insertOffset = 0;
      for (const character of insertedText) {
        const scalarIndex = index + insertOffset;
        const id = paperEventId(dataset, agentKey, agentSequence++);
        const utf16Index = utf16IndexForScalarIndex(unicodeState, scalarIndex);
        const timestamp = transactionIndex + operationOffset;
        const emittedEvent = sink.appendInsert(
          id,
          currentVersion,
          utf16Index,
          character,
          timestamp,
        );
        referenceSession?.applyEvent(
          emittedEvent ?? {
            id,
            parentVersion: new Set(currentVersion),
            operation: {
              type: OPERATION_TYPE.INSERT,
              index: utf16Index,
              text: character,
            },
            timestamp,
          },
        );
        updateFrontier(frontier, id, currentVersion);
        eventCount++;
        if (eventCount === options.maxEvents) {
          return { eventCount, frontier, limited: true };
        }
        unicodeState = insertScalar(unicodeState, scalarIndex, character);
        replaceVersionWithEvent(currentVersion, id);
        traceVersion++;
        operationOffset++;
        insertOffset++;
      }
    }

    const expectedEnd = transaction._dtSpan?.[1];
    if (expectedEnd !== undefined && traceVersion !== expectedEnd) {
      throw new Error(
        `${dataset}: transaction ${transactionIndex} emitted through trace version ${traceVersion}, expected ${expectedEnd}`,
      );
    }
    nextSequenceByAgent.set(agentKey, agentSequence);
    transactionVersions[transactionIndex] = currentVersion;
    transactionUnicodeStates[transactionIndex] = unicodeState;
  }

  if (validateFinalText) {
    if (referenceSession === undefined) {
      throw new Error(`${dataset}: missing scalar reference session`);
    }
    const actual = referenceSession.materializeVersion(frontier);
    if (actual !== trace.endContent) {
      throw new Error(
        `${dataset}: converted final text mismatch; expected ${JSON.stringify(trace.endContent)}, received ${JSON.stringify(actual)}`,
      );
    }
  }

  return { eventCount, frontier, limited: false };
};

const assertValidMaxEvents = (maxEvents: number | undefined): void => {
  if (
    maxEvents !== undefined &&
    (!Number.isSafeInteger(maxEvents) || maxEvents <= 0)
  ) {
    throw new Error(
      `maxEvents must be a positive safe integer, got ${maxEvents}`,
    );
  }
};

const updateFrontier = (
  frontier: Set<EventId>,
  eventId: EventId,
  parentVersion: Version,
): void => {
  for (const parentId of parentVersion) {
    frontier.delete(parentId);
  }
  frontier.add(eventId);
};

const replaceVersionWithEvent = (
  version: Set<EventId>,
  eventId: EventId,
): void => {
  version.clear();
  version.add(eventId);
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
  referenceSession: ScalarReferenceSession | undefined,
): UnicodeOffsetState | undefined => {
  if (transaction.parents.length === 0) {
    return {
      scalarLength: 0,
      nonBmpCodePointPositions: EMPTY_NON_BMP_POSITIONS,
    };
  }
  if (transaction.parents.length === 1) {
    const inherited = transactionUnicodeStates[transaction.parents[0]!];
    if (inherited !== undefined) {
      return inherited;
    }
  }
  return referenceSession === undefined
    ? undefined
    : unicodeStateFromText(referenceSession.materializeVersion(version));
};

/**
 * Validation always uses the independent scalar oracle. Benchmark conversion
 * can omit it when UTF-16 offsets are derivable without materializing merged
 * parent documents: BMP-only traces have identical scalar/UTF-16 indexes, and
 * non-BMP linear histories inherit their sparse offset state from one parent.
 */
const needsScalarReferenceSession = (
  trace: AtomicPaperTrace,
  validateFinalText: boolean,
): boolean => {
  if (validateFinalText) {
    return true;
  }

  const hasMerge = trace.txns.some(({ parents }) => parents.length > 1);
  if (!hasMerge) {
    return false;
  }

  return trace.txns.some(({ patches }) =>
    patches.some(([, , insertedText]) => containsNonBmpScalar(insertedText)),
  );
};

const containsNonBmpScalar = (text: string): boolean => {
  for (const character of text) {
    if (character.length === 2) {
      return true;
    }
  }
  return false;
};

const unicodeStateFromText = (text: string): UnicodeOffsetState => {
  const nonBmpCodePointPositions: number[] = [];
  let scalarLength = 0;
  for (const character of text) {
    if (character.length === 2) {
      nonBmpCodePointPositions.push(scalarLength);
    }
    scalarLength++;
  }
  return {
    scalarLength,
    nonBmpCodePointPositions:
      nonBmpCodePointPositions.length === 0
        ? EMPTY_NON_BMP_POSITIONS
        : nonBmpCodePointPositions,
  };
};

const utf16IndexForScalarIndex = (
  state: UnicodeOffsetState | undefined,
  scalarIndex: number,
): number =>
  scalarIndex +
  lowerBound(
    state?.nonBmpCodePointPositions ?? EMPTY_NON_BMP_POSITIONS,
    scalarIndex,
  );

const insertScalar = (
  state: UnicodeOffsetState | undefined,
  index: number,
  character: string,
): UnicodeOffsetState | undefined => {
  if (state === undefined) {
    return undefined;
  }
  const positions = state.nonBmpCodePointPositions;
  const insertsNonBmp = character.length === 2;
  if (positions.length === 0) {
    return {
      scalarLength: state.scalarLength + 1,
      nonBmpCodePointPositions: insertsNonBmp
        ? [index]
        : EMPTY_NON_BMP_POSITIONS,
    };
  }

  const insertionPoint = lowerBound(positions, index);
  const nextPositions = new Array<number>(
    positions.length + (insertsNonBmp ? 1 : 0),
  );
  for (let sourceIndex = 0; sourceIndex < insertionPoint; sourceIndex++) {
    nextPositions[sourceIndex] = positions[sourceIndex]!;
  }
  let targetIndex = insertionPoint;
  if (insertsNonBmp) {
    nextPositions[targetIndex++] = index;
  }
  for (
    let sourceIndex = insertionPoint;
    sourceIndex < positions.length;
    sourceIndex++
  ) {
    nextPositions[targetIndex++] = positions[sourceIndex]! + 1;
  }
  return {
    scalarLength: state.scalarLength + 1,
    nonBmpCodePointPositions: nextPositions,
  };
};

const deleteScalarRange = (
  state: UnicodeOffsetState | undefined,
  index: number,
  length: number,
): UnicodeOffsetState | undefined => {
  if (state === undefined) {
    return undefined;
  }
  const end = index + length;
  const positions = state.nonBmpCodePointPositions;
  if (positions.length === 0) {
    return {
      scalarLength: state.scalarLength - length,
      nonBmpCodePointPositions: EMPTY_NON_BMP_POSITIONS,
    };
  }
  const firstDeleted = lowerBound(positions, index);
  const firstAfterDeleted = lowerBound(positions, end);
  const nextPositions = new Array<number>(
    positions.length - (firstAfterDeleted - firstDeleted),
  );
  for (let sourceIndex = 0; sourceIndex < firstDeleted; sourceIndex++) {
    nextPositions[sourceIndex] = positions[sourceIndex]!;
  }
  let targetIndex = firstDeleted;
  for (
    let sourceIndex = firstAfterDeleted;
    sourceIndex < positions.length;
    sourceIndex++
  ) {
    nextPositions[targetIndex++] = positions[sourceIndex]! - length;
  }
  return {
    scalarLength: state.scalarLength - length,
    nonBmpCodePointPositions:
      nextPositions.length === 0 ? EMPTY_NON_BMP_POSITIONS : nextPositions,
  };
};

const assertScalarRange = (
  state: UnicodeOffsetState | undefined,
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
  if (
    state !== undefined &&
    (index > state.scalarLength || length > state.scalarLength - index)
  ) {
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
  agentKey: string,
  sequence: number,
): EventId =>
  `paper:${encodeURIComponent(dataset)}:agent:${agentKey}:${sequence}`;

const paperAgentKey = (agent: number | string): string => {
  if (typeof agent === "string") {
    return `string:${agent}`;
  }
  if (!Number.isSafeInteger(agent) || agent < 0) {
    throw new Error(`paper trace contains an invalid numeric agent ${agent}`);
  }
  return `number:${agent.toString().padStart(16, "0")}`;
};
