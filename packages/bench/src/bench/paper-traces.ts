import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  OPERATION_TYPE,
  type EventId,
  type GraphEvent,
  type Version,
} from "@softmaple/eg-walker";
import { convertPaperTraceToAtomicEvents } from "@softmaple/eg-walker/internal";

export const PAPER_DATASETS = [
  "S1",
  "S2",
  "S3",
  "C1",
  "C2",
  "A1",
  "A2",
] as const;

export type PaperDataset = (typeof PAPER_DATASETS)[number];

export interface PaperTrace {
  readonly kind: string;
  readonly endContent: string;
  readonly numAgents: number;
  readonly txns: ReadonlyArray<PaperTxn>;
}

export interface PaperTxn {
  readonly parents: ReadonlyArray<number>;
  readonly numChildren: number;
  readonly agent: number;
  readonly time?: string;
  readonly patches: ReadonlyArray<PaperPatch>;
  readonly _dtSpan?: readonly [number, number];
}

export type PaperPatch = readonly [
  index: number,
  deleteLength: number,
  insertedText: string,
];

export interface LoadedPaperTrace {
  readonly dataset: PaperDataset;
  readonly trace: PaperTrace;
  readonly events: ReadonlyArray<GraphEvent>;
  readonly txnCount: number;
  readonly patchCount: number;
  readonly limited: boolean;
}

export interface LoadPaperTraceOptions {
  readonly maxTxns?: number;
  readonly maxEvents?: number;
  readonly granularity?: PaperTraceGranularity;
}

export type PaperTraceGranularity = "patch" | "operation";

const cloneVersion = (version: Version): Set<EventId> => new Set(version);

// Paper traces use Unicode scalar offsets; eg-walker public operations use
// UTF-16 code-unit offsets. Track non-BMP character positions sparsely so
// benchmark conversion can translate indexes without materializing documents.
type UnicodeOffsetState = ReadonlyArray<number>;

const unionParentVersions = (
  dataset: PaperDataset,
  txnIndex: number,
  txns: ReadonlyArray<PaperTxn>,
  txnVersions: ReadonlyArray<ReadonlySet<EventId> | undefined>,
): Set<EventId> => {
  const version = new Set<EventId>();
  for (const parentIndex of txns[txnIndex]?.parents ?? []) {
    const parentVersion = txnVersions[parentIndex];
    if (parentVersion === undefined) {
      throw new Error(
        `${dataset}: txn ${txnIndex} references unknown parent txn ${parentIndex}`,
      );
    }
    for (const eventId of parentVersion) {
      version.add(eventId);
    }
  }
  return version;
};

const unicodeOffsetStateForTxn = (
  txnIndex: number,
  txns: ReadonlyArray<PaperTxn>,
  txnUnicodeStates: ReadonlyArray<UnicodeOffsetState | undefined>,
): number[] | undefined => {
  const parents = txns[txnIndex]?.parents ?? [];
  if (parents.length === 0) {
    return [];
  }
  if (parents.length !== 1) {
    return undefined;
  }
  const parentState = txnUnicodeStates[parents[0] ?? -1];
  return parentState ? [...parentState] : undefined;
};

const lowerBound = (values: UnicodeOffsetState, target: number): number => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const value = values[mid] ?? 0;
    if (value < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
};

const utf16IndexForCodePointIndex = (
  state: UnicodeOffsetState | undefined,
  index: number,
): number => {
  if (!state) {
    return index;
  }
  return index + lowerBound(state, index);
};

const utf16LengthForCodePointRange = (
  state: UnicodeOffsetState | undefined,
  index: number,
  length: number,
): number => {
  if (!state) {
    return length;
  }
  const end = index + length;
  return length + lowerBound(state, end) - lowerBound(state, index);
};

const advanceUnicodeOffsetState = (
  state: number[] | undefined,
  index: number,
  deleteLength: number,
  insertedText: string,
): number[] | undefined => {
  if (!state) {
    return undefined;
  }
  const deleteEnd = index + deleteLength;
  const firstDeleted = lowerBound(state, index);
  const firstAfterDeleted = lowerBound(state, deleteEnd);
  const insertedCharacters = Array.from(insertedText);
  const delta = insertedCharacters.length - deleteLength;
  const insertedNonBmpPositions = insertedCharacters.flatMap(
    (character, offset) => (character.length > 1 ? [index + offset] : []),
  );
  return [
    ...state.slice(0, firstDeleted),
    ...insertedNonBmpPositions,
    ...state.slice(firstAfterDeleted).map((position) => position + delta),
  ];
};

const timestampForTxn = (txn: PaperTxn, fallback: number): number => {
  if (txn.time === undefined) {
    return fallback;
  }
  const parsed = Date.parse(txn.time);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const parseDatasetList = (value: string): PaperDataset[] => {
  const names =
    value.trim().toLowerCase() === "all"
      ? [...PAPER_DATASETS]
      : value.split(",").map((item) => item.trim().toUpperCase());

  const datasets: PaperDataset[] = [];
  for (const name of names) {
    if (!PAPER_DATASETS.includes(name as PaperDataset)) {
      throw new Error(
        `Unknown paper dataset "${name}". Expected one of ${PAPER_DATASETS.join(", ")} or "all".`,
      );
    }
    datasets.push(name as PaperDataset);
  }
  return datasets;
};

export const paperTracePath = (
  paperRoot: string,
  dataset: PaperDataset,
): string => join(paperRoot, "datasets", `${dataset}.json`);

export const readPaperTrace = (
  paperRoot: string,
  dataset: PaperDataset,
): PaperTrace => {
  const path = paperTracePath(paperRoot, dataset);
  return JSON.parse(readFileSync(path, "utf8")) as PaperTrace;
};

/**
 * Convert paper transaction patches into SoftMaple GraphEvents. Operation mode
 * delegates to the conformance converter so benchmark semantics and event IDs
 * stay aligned with the paper oracle. Patch mode is an explicitly non-faithful
 * import-stress mode that keeps long inserted strings compound.
 */
export const convertPaperTraceToEvents = (
  dataset: PaperDataset,
  trace: PaperTrace,
  granularity: PaperTraceGranularity = "patch",
  maxEvents?: number,
): GraphEvent[] => {
  if (granularity === "operation") {
    return convertPaperTraceToAtomicEvents(dataset, trace, {
      validateFinalText: false,
      maxEvents,
    });
  }

  const events: GraphEvent[] = [];
  const txnVersions: Array<ReadonlySet<EventId> | undefined> = new Array(
    trace.txns.length,
  );
  const txnUnicodeStates: Array<UnicodeOffsetState | undefined> = new Array(
    trace.txns.length,
  );

  for (let txnIndex = 0; txnIndex < trace.txns.length; txnIndex++) {
    const txn = trace.txns[txnIndex];
    if (txn === undefined) {
      throw new Error(`${dataset}: missing txn ${txnIndex}`);
    }

    let currentVersion = unionParentVersions(
      dataset,
      txnIndex,
      trace.txns,
      txnVersions,
    );
    let currentUnicodeState = unicodeOffsetStateForTxn(
      txnIndex,
      trace.txns,
      txnUnicodeStates,
    );
    const timestampBase = timestampForTxn(txn, txnIndex);
    let emittedInTxn = 0;

    for (let patchIndex = 0; patchIndex < txn.patches.length; patchIndex++) {
      const patch = txn.patches[patchIndex];
      if (patch === undefined) {
        throw new Error(
          `${dataset}: txn ${txnIndex} missing patch ${patchIndex}`,
        );
      }

      const [index, deleteLength, insertedText] = patch;
      if (deleteLength > 0) {
        const utf16Index = utf16IndexForCodePointIndex(
          currentUnicodeState,
          index,
        );
        const utf16Length = utf16LengthForCodePointRange(
          currentUnicodeState,
          index,
          deleteLength,
        );
        const id = `paper:${dataset}:txn:${txnIndex}:patch:${patchIndex}:del`;
        events.push({
          id,
          parentVersion: cloneVersion(currentVersion),
          operation: {
            type: OPERATION_TYPE.DELETE,
            index: utf16Index,
            length: utf16Length,
          },
          timestamp: timestampBase + emittedInTxn,
        });
        currentUnicodeState = advanceUnicodeOffsetState(
          currentUnicodeState,
          index,
          deleteLength,
          "",
        );
        currentVersion = new Set([id]);
        emittedInTxn++;
      }

      if (insertedText.length > 0) {
        const utf16Index = utf16IndexForCodePointIndex(
          currentUnicodeState,
          index,
        );
        const id = `paper:${dataset}:txn:${txnIndex}:patch:${patchIndex}:ins`;
        events.push({
          id,
          parentVersion: cloneVersion(currentVersion),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: utf16Index,
            text: insertedText,
          },
          timestamp: timestampBase + emittedInTxn,
        });
        currentUnicodeState = advanceUnicodeOffsetState(
          currentUnicodeState,
          index,
          0,
          insertedText,
        );
        currentVersion = new Set([id]);
        emittedInTxn++;
      }
    }

    txnVersions[txnIndex] = currentVersion;
    txnUnicodeStates[txnIndex] = currentUnicodeState;
  }

  return events;
};

export const loadPaperTrace = (
  paperRoot: string,
  dataset: PaperDataset,
  options: LoadPaperTraceOptions = {},
): LoadedPaperTrace => {
  const trace = readPaperTrace(paperRoot, dataset);
  const txns =
    options.maxTxns === undefined
      ? trace.txns
      : trace.txns.slice(0, options.maxTxns);
  const limitedTrace: PaperTrace =
    txns === trace.txns ? trace : { ...trace, txns };
  const convertedEvents = convertPaperTraceToEvents(
    dataset,
    limitedTrace,
    options.granularity,
    options.maxEvents,
  );
  const events =
    options.maxEvents === undefined
      ? convertedEvents
      : convertedEvents.slice(0, options.maxEvents);
  const patchCount = txns.reduce((count, txn) => count + txn.patches.length, 0);
  return {
    dataset,
    trace,
    events,
    txnCount: txns.length,
    patchCount,
    limited:
      txns.length !== trace.txns.length ||
      events.length !== convertedEvents.length ||
      (options.maxEvents !== undefined && events.length === options.maxEvents),
  };
};
