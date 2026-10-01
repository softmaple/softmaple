import lz4 from "lz4js";

import type { EventId } from "../../types";
import { canonicalSequenceAfter } from "../event-id";
import { BinaryWriter, EGW4_MAGIC, encodeText } from "../internals/binary-io";
import { crc32 } from "../internals/crc32";
import {
  EGW4_MANY_PARENTS,
  EGW4_MAX_EVENTS,
  EGW4_MIN_REPEAT,
  EGW4_SEGMENT,
  EGW4_SPAN,
} from "./egw4-format";

/**
 * Per-event columns of a graph in wire order, read by position.
 *
 * Both EGW4 encoders describe their input through this interface, so the
 * same events and order produce the same bytes whichever encoder wrote them.
 */
export interface Egw4EncodeColumns {
  readonly count: number;
  isInsertAt(position: number): boolean;
  operationIndexAt(position: number): number;
  /** Insert text length, or delete length. */
  operationLengthAt(position: number): number;
  timestampAt(position: number): number;
  /** Whether the event's only parent is the previous event (none at 0). */
  hasDefaultParentsAt(position: number): boolean;
  parentCountAt(position: number): number;
  /** Position of a parent, in the event's parent order. */
  parentPositionAt(position: number, parentIndex: number): number;
}

export interface Egw4EncodeInput {
  readonly columns: Egw4EncodeColumns;
  readonly ids: Egw4IdRuns;
  /** Number of positions whose parents are not the default. */
  readonly overrideCount: number;
  /** Inserted text of every insert, in wire order. */
  readonly insertedText: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface IdRunState {
  readonly string: number;
  readonly startSequence: number;
  length: number;
  readonly custom: boolean;
}

/**
 * The string table and ID runs of an EGW4 payload, built one event at a time
 * in wire order.
 *
 * Every replica ID and custom event ID is written once; runs refer to it by
 * its index in the table, numbered in first-seen order.
 */
export class Egw4IdRuns {
  private readonly strings: string[] = [];
  private readonly stringIndexes = new Map<string, number>();
  /** String index of each graph agent seen by {@link appendCanonical}. */
  private readonly stringByAgent: number[] = [];
  private readonly runs: IdRunState[] = [];
  private events = 0;

  get eventCount(): number {
    return this.events;
  }

  /** Append an event ID, as `replicaId:sequence` when it parses as one. */
  appendId(id: EventId): void {
    const colonIndex = id.lastIndexOf(":");
    const sequence = canonicalSequenceAfter(id, colonIndex);
    if (sequence < 0) {
      this.appendCustom(id);
      return;
    }
    const last = this.runs[this.runs.length - 1];
    if (
      last !== undefined &&
      !last.custom &&
      last.startSequence + last.length === sequence
    ) {
      const replicaId = this.strings[last.string]!;
      if (replicaId.length === colonIndex && id.startsWith(replicaId)) {
        last.length++;
        this.events++;
        return;
      }
    }
    this.pushCanonical(this.intern(id.slice(0, colonIndex)), sequence);
  }

  /**
   * Append the canonical ID `replicaId:sequence` of a graph agent. `agent`
   * only caches the string lookup; equal agents must name equal replicas.
   */
  appendCanonical(agent: number, replicaId: string, sequence: number): void {
    let string = this.stringByAgent[agent];
    if (string === undefined) {
      string = this.intern(replicaId);
      this.stringByAgent[agent] = string;
    }
    const last = this.runs[this.runs.length - 1];
    if (
      last !== undefined &&
      !last.custom &&
      last.string === string &&
      last.startSequence + last.length === sequence
    ) {
      last.length++;
      this.events++;
      return;
    }
    this.pushCanonical(string, sequence);
  }

  /** Append an ID that does not parse as `replicaId:sequence`. */
  appendCustom(id: EventId): void {
    this.runs.push({
      string: this.intern(id),
      startSequence: 0,
      length: 1,
      custom: true,
    });
    this.events++;
  }

  write(writer: BinaryWriter): void {
    writer.writeVarint(this.strings.length);
    for (const string of this.strings) {
      writer.writeString(string);
    }
    const nextSequence = new Array<number>(this.strings.length).fill(0);
    for (const run of this.runs) {
      if (run.custom) {
        writer.writeVarint(run.string * 2 + 1);
        continue;
      }
      writer.writeVarint(run.string * 2);
      const jumped = run.startSequence !== nextSequence[run.string];
      writer.writeVarint(run.length * 2 + (jumped ? 1 : 0));
      if (jumped) {
        writer.writeVarint(run.startSequence);
      }
      nextSequence[run.string] = run.startSequence + run.length;
    }
  }

  private pushCanonical(string: number, sequence: number): void {
    this.runs.push({
      string,
      startSequence: sequence,
      length: 1,
      custom: false,
    });
    this.events++;
  }

  private intern(string: string): number {
    let index = this.stringIndexes.get(string);
    if (index === undefined) {
      index = this.strings.length;
      this.strings.push(string);
      this.stringIndexes.set(string, index);
    }
    return index;
  }
}

/** Encode validated columns as an EGW4 payload. */
export const encodeEgw4 = (input: Egw4EncodeInput): Uint8Array => {
  const { columns } = input;
  if (columns.count > EGW4_MAX_EVENTS) {
    throw new Error(
      `Graph has ${columns.count} events but EGW4 holds at most ${EGW4_MAX_EVENTS}`,
    );
  }
  if (input.ids.eventCount !== columns.count) {
    throw new Error(
      `ID runs cover ${input.ids.eventCount} events but the graph has ${columns.count}`,
    );
  }
  const writer = new BinaryWriter();
  writer.writeBytes(EGW4_MAGIC);
  writer.writeVarint(columns.count);
  input.ids.write(writer);
  writeParentOverrides(writer, columns, input.overrideCount);
  writeUnsignedRuns(writer, columns.count, (position) =>
    columns.operationLengthAt(position),
  );
  writeOperationSpans(writer, columns);
  writer.writeBytes(lz4.compress(encodeText(input.insertedText)));
  writeDeltaSegments(writer, columns.count, (position) =>
    columns.timestampAt(position),
  );
  writer.writeString(JSON.stringify(input.metadata));
  writer.writeUint32LE(crc32(writer.view()));
  return writer.toUint8Array();
};

const writeParentOverrides = (
  writer: BinaryWriter,
  columns: Egw4EncodeColumns,
  overrideCount: number,
): void => {
  writer.writeVarint(overrideCount);
  let previous = -1;
  let written = 0;
  for (let position = 0; position < columns.count; position++) {
    if (columns.hasDefaultParentsAt(position)) {
      continue;
    }
    const parentCount = columns.parentCountAt(position);
    const gap = position - previous - 1;
    if (parentCount < EGW4_MANY_PARENTS) {
      writer.writeVarint(gap * 4 + parentCount);
    } else {
      writer.writeVarint(gap * 4 + EGW4_MANY_PARENTS);
      writer.writeVarint(parentCount - EGW4_MANY_PARENTS);
    }
    for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
      writer.writeVarint(
        position - columns.parentPositionAt(position, parentIndex),
      );
    }
    previous = position;
    written++;
  }
  if (written !== overrideCount) {
    throw new Error(
      `Expected ${overrideCount} parent overrides but found ${written}`,
    );
  }
};

/**
 * Write non-negative integers as repeat runs (at least
 * {@link EGW4_MIN_REPEAT} equal values) and literal runs (everything else).
 */
const writeUnsignedRuns = (
  writer: BinaryWriter,
  count: number,
  valueAt: (position: number) => number,
): void => {
  let position = 0;
  while (position < count) {
    const value = valueAt(position);
    let end = position + 1;
    while (end < count && valueAt(end) === value) {
      end++;
    }
    if (end - position >= EGW4_MIN_REPEAT) {
      writer.writeVarint((end - position) * 2);
      writer.writeVarint(value);
      position = end;
      continue;
    }
    // A literal run takes values until a repeat run could start.
    let literalEnd = end;
    while (literalEnd < count) {
      const next = valueAt(literalEnd);
      let repeatEnd = literalEnd + 1;
      while (
        repeatEnd < count &&
        repeatEnd - literalEnd < EGW4_MIN_REPEAT &&
        valueAt(repeatEnd) === next
      ) {
        repeatEnd++;
      }
      if (repeatEnd - literalEnd >= EGW4_MIN_REPEAT) {
        break;
      }
      literalEnd = repeatEnd;
    }
    writer.writeVarint((literalEnd - position) * 2 + 1);
    for (let literal = position; literal < literalEnd; literal++) {
      writer.writeVarint(valueAt(literal));
    }
    position = literalEnd;
  }
};

/**
 * Write events as typing, delete-in-place and backspace spans. Each span
 * stores its event count, its kind and how far its anchor is from where the
 * previous span left the cursor; indexes inside a span follow from the
 * lengths column.
 */
const writeOperationSpans = (
  writer: BinaryWriter,
  columns: Egw4EncodeColumns,
): void => {
  const count = columns.count;
  let cursor = 0;
  let position = 0;
  while (position < count) {
    const index = columns.operationIndexAt(position);
    // Callers validate that every operation ends in the safe range.
    const after = index + columns.operationLengthAt(position);
    let end = position + 1;
    let kind: number;
    let anchor: number;
    let cursorAfter: number;
    if (columns.isInsertAt(position)) {
      kind = EGW4_SPAN.INSERT;
      anchor = index;
      cursorAfter = after;
      while (
        end < count &&
        columns.isInsertAt(end) &&
        columns.operationIndexAt(end) === cursorAfter
      ) {
        cursorAfter += columns.operationLengthAt(end);
        end++;
      }
    } else if (
      end < count &&
      !columns.isInsertAt(end) &&
      columns.operationIndexAt(end) !== index &&
      columns.operationIndexAt(end) + columns.operationLengthAt(end) === index
    ) {
      kind = EGW4_SPAN.BACKSPACE;
      anchor = after;
      cursorAfter = columns.operationIndexAt(end);
      end++;
      while (
        end < count &&
        !columns.isInsertAt(end) &&
        columns.operationIndexAt(end) + columns.operationLengthAt(end) ===
          cursorAfter
      ) {
        cursorAfter = columns.operationIndexAt(end);
        end++;
      }
    } else {
      kind = EGW4_SPAN.DELETE;
      anchor = index;
      cursorAfter = index;
      while (
        end < count &&
        !columns.isInsertAt(end) &&
        columns.operationIndexAt(end) === index
      ) {
        end++;
      }
    }
    writer.writeVarint((end - position) * 4 + kind);
    writer.writeZigZagVarint(anchor - cursor);
    cursor = cursorAfter;
    position = end;
  }
};

/**
 * Write integers as delta segments: a first delta followed by values that
 * each add the current step, or a literal run of deltas.
 */
const writeDeltaSegments = (
  writer: BinaryWriter,
  count: number,
  valueAt: (position: number) => number,
): void => {
  let previous = 0;
  let step = 0;
  let literalStart = -1;
  const flushLiteral = (end: number): void => {
    if (literalStart < 0) {
      return;
    }
    writer.writeVarint((end - literalStart) * 4 + EGW4_SEGMENT.LITERAL);
    let before = literalStart === 0 ? 0 : valueAt(literalStart - 1);
    for (let literal = literalStart; literal < end; literal++) {
      const value = valueAt(literal);
      writer.writeZigZagVarint(value - before);
      before = value;
    }
    literalStart = -1;
  };

  let position = 0;
  while (position < count) {
    const value = valueAt(position);
    let end = position + 1;
    let segmentStep = step;
    if (end < count) {
      segmentStep = valueAt(end) - value;
      end++;
      while (end < count && valueAt(end) - valueAt(end - 1) === segmentStep) {
        end++;
      }
    }
    const length = end - position;
    if (length >= 3 || (length === 2 && segmentStep === step)) {
      flushLiteral(position);
      const changed = segmentStep !== step;
      writer.writeVarint(
        length * 4 + (changed ? EGW4_SEGMENT.NEW_STEP : EGW4_SEGMENT.SAME_STEP),
      );
      writer.writeZigZagVarint(value - previous);
      if (changed) {
        writer.writeZigZagVarint(segmentStep);
        step = segmentStep;
      }
      previous = valueAt(end - 1);
      position = end;
    } else {
      if (literalStart < 0) {
        literalStart = position;
      }
      previous = value;
      position++;
    }
  }
  flushLiteral(count);
};
