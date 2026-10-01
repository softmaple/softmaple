import type { EventId, GraphEvent } from "../../types";
import type { BinaryReader } from "../internals/binary-io";
import { parseEventId } from "../event-id";
import type { IdRun } from "./types";

export const encodeIdRuns = (events: ReadonlyArray<GraphEvent>): IdRun[] => {
  const runs: IdRun[] = [];

  for (const [eventOffset, event] of events.entries()) {
    const parsed = parseEventId(event.id);
    if (!parsed) {
      runs.push({
        replicaId: event.id,
        startSequence: 0,
        startEventOffset: eventOffset,
        length: 1,
        custom: true,
      });
      continue;
    }

    const previous = runs[runs.length - 1];
    const canExtend =
      previous &&
      !previous.custom &&
      previous.replicaId === parsed.replicaId &&
      previous.startSequence + previous.length === parsed.sequence &&
      previous.startEventOffset + previous.length === eventOffset;

    if (canExtend) {
      runs[runs.length - 1] = { ...previous, length: previous.length + 1 };
    } else {
      runs.push({
        replicaId: parsed.replicaId,
        startSequence: parsed.sequence,
        startEventOffset: eventOffset,
        length: 1,
        custom: false,
      });
    }
  }

  return runs;
};

/**
 * Read EGW3 ID runs. Runs are in topological order, so `startEventOffset` is
 * the prefix sum of run lengths and is not on the wire; the `custom` flag is
 * the low bit of the length varint.
 */
export const readIdRuns = (reader: BinaryReader): IdRun[] => {
  const length = reader.readVarint();
  const runs: IdRun[] = [];
  let cursor = 0;
  for (let i = 0; i < length; i++) {
    const replicaId = reader.readString();
    const startSequence = reader.readVarint();
    const packed = reader.readVarint();
    const custom = packed % 2 === 1;
    const runLength = Math.floor(packed / 2);
    if (runLength === 0) {
      throw new Error(`ID run must have positive length, got ${runLength}`);
    }
    // {@link encodeIdRuns} only emits custom runs with `length: 1`
    // (verbatim string IDs are never coalesced). Encoder bugs that
    // violate this invariant would shift every subsequent event ID
    // silently, so guard it at the decode boundary.
    if (custom && runLength !== 1) {
      throw new Error(`Custom id run must have length 1, got ${runLength}`);
    }
    runs.push({
      replicaId,
      startSequence,
      startEventOffset: cursor,
      length: runLength,
      custom,
    });
    cursor += runLength;
  }
  return runs;
};

export const decodeIds = (runs: ReadonlyArray<IdRun>): EventId[] => {
  const ids: EventId[] = [];

  for (const run of runs) {
    for (let offset = 0; offset < run.length; offset++) {
      ids[run.startEventOffset + offset] = run.custom
        ? run.replicaId
        : `${run.replicaId}:${run.startSequence + offset}`;
    }
  }

  return ids;
};
