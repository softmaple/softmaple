import lz4 from "lz4js";

import type { EventId } from "../../types";
import { EventGraph } from "../event-graph";
import { canonicalSequenceAfter } from "../event-id";
import {
  BinaryReader,
  decodeTextStrict,
  EGW4_MAGIC,
  toUint8Array,
} from "../internals/binary-io";
import { crc32 } from "../internals/crc32";
import { EventIdRunIndex } from "../internals/event-id-run-index";
import { assertWithinEventLimit } from "../internals/event-limit";
import { GraphRuns } from "../internals/graph-runs";
import type { Steps } from "../internals/steps";
import {
  PACKED_OPERATION_TYPE,
  PackedEventGraphBase,
} from "../internals/packed-event-graph-base";
import type {
  PackedIntegerColumn,
  PackedUnsignedIntegerColumn,
} from "../internals/packed-numeric-columns";
import {
  EGW4_CHECKSUM_BYTES,
  EGW4_MANY_PARENTS,
  EGW4_MAX_EVENTS,
  EGW4_SEGMENT,
  EGW4_SPAN,
  unwrapAnchor,
} from "./egw4-format";
import { strictMetadata } from "./graph-validation";
import type { IdRun } from "./types";

const INT32_MIN = -0x8000_0000;
const INT32_MAX = 0x7fff_ffff;
const UINT32_MAX = 0xffff_ffff;
/** Upper bound on LZ4 output bytes per input byte. */
const LZ4_MAX_EXPANSION = 256;

interface ParentOverrides {
  readonly explicit: Uint32Array;
  readonly parentStarts: Uint32Array;
  readonly parents: Uint32Array;
}

interface OperationColumns {
  readonly operationTypes: Uint8Array;
  readonly operationIndexes: PackedUnsignedIntegerColumn;
  readonly insertStarts: Uint32Array;
  readonly insertedLength: number;
}

/**
 * Decode an EGW4 payload (see `egw4-format.ts`) into a packed graph, in
 * steps of one or two columns each for a caller that must pause between
 * them. `bytes` must not change until the generator returns.
 *
 * The checksum is verified before anything else is read, and every column is
 * validated as it is decoded. IDs stay in the run index and parents are
 * offsets, so no per-event ID string or edge object is built. A payload
 * declaring more than `maxEvents` events is rejected before any per-event
 * column is allocated.
 */
export function* decodeEgw4GraphSteps(
  bytes: Uint8Array,
  maxEvents = Number.POSITIVE_INFINITY,
): Steps<EventGraph> {
  const reader = new BinaryReader(verifyChecksum(bytes));
  const magic = reader.readByteView(reader.readVarint());
  if (
    magic.length !== EGW4_MAGIC.length ||
    !EGW4_MAGIC.every((byte, index) => magic[index] === byte)
  ) {
    throw new Error("Invalid eg-walker columnar graph header");
  }

  const count = reader.readVarint();
  // Checked before any per-event column is allocated.
  if (count > EGW4_MAX_EVENTS) {
    throw new Error(
      `Graph event count ${count} exceeds the EGW4 limit of ${EGW4_MAX_EVENTS} events`,
    );
  }
  assertWithinEventLimit(count, maxEvents);
  const strings = readStrings(reader);
  const idRuns = readIdRuns(reader, strings, count);
  yield;
  const overrides = readParentOverrides(reader, count);
  yield;
  const operationLengths = readLengths(reader, count);
  const operations = readOperations(reader, count, operationLengths);
  yield;
  const insertedContent = readInsertedContent(
    reader,
    operations,
    operationLengths,
  );
  yield;
  const timestamps = readTimestamps(reader, count);
  const metadata = readMetadata(reader);
  if (reader.remainingByteLength !== 0) {
    throw new Error("Invalid eg-walker columnar graph: trailing bytes");
  }
  yield;

  const idIndex = EventIdRunIndex.fromRuns(idRuns, count).view();
  yield;
  const runs =
    overrides.explicit.length === 0
      ? GraphRuns.linear(count)
      : GraphRuns.fromExplicitParents(
          count,
          overrides.explicit,
          overrides.parentStarts,
          overrides.parents,
        );
  yield;
  // Only the last event of a run can lack a child.
  const frontier = new Set<EventId>();
  for (let run = 0; run < runs.count; run++) {
    if (runs.childCountOf(run) === 0) {
      frontier.add(idIndex.idAt(runs.lastOf(run))!);
    }
  }
  const base = PackedEventGraphBase.create({
    idIndex,
    operationTypes: operations.operationTypes,
    operationIndexes: operations.operationIndexes,
    operationLengths,
    timestamps,
    insertStarts: operations.insertStarts,
    insertedContent,
    runs,
  });
  return EventGraph.fromPackedBase(base, frontier, metadata);
}

/** The payload without its checksum, once the checksum matches. */
const verifyChecksum = (bytes: Uint8Array): Uint8Array => {
  if (bytes.length < EGW4_CHECKSUM_BYTES) {
    throw new Error("Unexpected end of binary eg-walker graph");
  }
  const end = bytes.length - EGW4_CHECKSUM_BYTES;
  const expected =
    (bytes[end]! |
      (bytes[end + 1]! << 8) |
      (bytes[end + 2]! << 16) |
      (bytes[end + 3]! << 24)) >>>
    0;
  const payload = bytes.subarray(0, end);
  if (crc32(payload) !== expected) {
    throw new Error("Invalid eg-walker columnar graph: checksum mismatch");
  }
  return payload;
};

const readStrictString = (reader: BinaryReader): string =>
  decodeTextStrict(reader.readByteView(reader.readVarint()));

const readStrings = (reader: BinaryReader): string[] => {
  const count = reader.readVarint();
  // Every string takes at least its length byte.
  if (count > reader.remainingByteLength) {
    throw new Error("Unexpected end of binary eg-walker graph");
  }
  const strings = new Array<string>(count);
  const seen = new Set<string>();
  for (let index = 0; index < count; index++) {
    const string = readStrictString(reader);
    if (string.length === 0) {
      throw new Error(`ID string ${index} is empty`);
    }
    if (seen.has(string)) {
      throw new Error(`ID string ${index} repeats ${string}`);
    }
    seen.add(string);
    strings[index] = string;
  }
  return strings;
};

const readIdRuns = (
  reader: BinaryReader,
  strings: ReadonlyArray<string>,
  count: number,
): IdRun[] => {
  const runs: IdRun[] = [];
  const nextSequence = new Array<number>(strings.length).fill(0);
  let covered = 0;
  while (covered < count) {
    const head = reader.readVarint();
    const stringIndex = Math.floor(head / 2);
    const string = strings[stringIndex];
    if (string === undefined) {
      throw new Error(
        `ID run ${runs.length} refers to missing string ${stringIndex}`,
      );
    }
    if (head % 2 === 1) {
      if (canonicalSequenceAfter(string, string.lastIndexOf(":")) >= 0) {
        throw new Error(`Custom event ID ${string} must not be canonical`);
      }
      runs.push({
        replicaId: string,
        startSequence: 0,
        startEventOffset: covered,
        length: 1,
        custom: true,
      });
      covered++;
      continue;
    }
    const packedLength = reader.readVarint();
    const length = Math.floor(packedLength / 2);
    if (length === 0 || length > count - covered) {
      throw new Error(`ID run ${runs.length} has invalid length ${length}`);
    }
    const startSequence =
      packedLength % 2 === 1 ? reader.readVarint() : nextSequence[stringIndex]!;
    const endSequence = startSequence + length;
    if (!Number.isSafeInteger(endSequence - 1)) {
      throw new Error(`ID run ${runs.length} exceeds the safe sequence range`);
    }
    runs.push({
      replicaId: string,
      startSequence,
      startEventOffset: covered,
      length,
      custom: false,
    });
    nextSequence[stringIndex] = endSequence;
    covered += length;
  }
  return runs;
};

const readParentOverrides = (
  reader: BinaryReader,
  count: number,
): ParentOverrides => {
  const overrideCount = reader.readVarint();
  // Every override takes at least its header byte.
  if (overrideCount > count || overrideCount > reader.remainingByteLength) {
    throw new Error(`Invalid parent override count ${overrideCount}`);
  }
  const explicit = new Uint32Array(overrideCount);
  const parentStarts = new Uint32Array(overrideCount + 1);
  let parents = new Uint32Array(Math.max(8, overrideCount * 2));
  let parentCount = 0;
  let edgeCount = Math.max(0, count - 1);
  let previous = -1;
  for (let override = 0; override < overrideCount; override++) {
    const head = reader.readVarint();
    const code = head % 4;
    const offset = previous + 1 + (head - code) / 4;
    if (offset >= count) {
      throw new Error(`Invalid parent override offset ${offset}`);
    }
    const eventParents =
      code < EGW4_MANY_PARENTS ? code : EGW4_MANY_PARENTS + reader.readVarint();
    // Parents are distinct earlier events, and each takes at least a byte.
    if (eventParents > offset || eventParents > reader.remainingByteLength) {
      throw new Error(
        `Event at offset ${offset} lists ${eventParents} parents`,
      );
    }
    if (parentCount + eventParents > parents.length) {
      const grown = new Uint32Array(
        Math.max(parents.length * 2, parentCount + eventParents),
      );
      grown.set(parents.subarray(0, parentCount));
      parents = grown;
    }
    for (let index = 0; index < eventParents; index++) {
      const distance = reader.readVarint();
      if (distance === 0 || distance > offset) {
        throw new Error(
          `Event at offset ${offset} has a parent that is not before it`,
        );
      }
      parents[parentCount + index] = offset - distance;
    }
    assertDistinctParents(parents, parentCount, eventParents, offset);
    const isDefault =
      offset === 0
        ? eventParents === 0
        : eventParents === 1 && parents[parentCount] === offset - 1;
    if (isDefault) {
      throw new Error(`Redundant parent override at offset ${offset}`);
    }
    // An override replaces the implicit edge from the previous event.
    edgeCount += eventParents - (offset > 0 ? 1 : 0);
    if (edgeCount > UINT32_MAX) {
      throw new Error("Packed event graph contains too many edges");
    }
    parentCount += eventParents;
    explicit[override] = offset;
    parentStarts[override + 1] = parentCount;
    previous = offset;
  }
  return {
    explicit,
    parentStarts,
    parents: parents.subarray(0, parentCount),
  };
};

const assertDistinctParents = (
  parents: Uint32Array,
  start: number,
  length: number,
  offset: number,
): void => {
  if (length < 2) {
    return;
  }
  if (length === 2) {
    if (parents[start] === parents[start + 1]) {
      throw new Error(`Event at offset ${offset} repeats a parent`);
    }
    return;
  }
  const sorted = parents.slice(start, start + length).sort();
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index] === sorted[index - 1]) {
      throw new Error(`Event at offset ${offset} repeats a parent`);
    }
  }
};

/**
 * Unsigned runs into a `Uint32Array`, or into a `Float64Array` when a value
 * does not fit. The narrow pass stops at the first wide value and the column
 * is read again from its start.
 */
const readLengths = (
  reader: BinaryReader,
  count: number,
): PackedUnsignedIntegerColumn => {
  const start = reader.position;
  const narrow = readUnsignedRunsInto(
    reader,
    new Uint32Array(count),
    UINT32_MAX,
  );
  if (narrow !== null) {
    return narrow;
  }
  reader.rewind(start);
  return readUnsignedRunsInto(
    reader,
    new Float64Array(count),
    Number.MAX_SAFE_INTEGER,
  )!;
};

const readUnsignedRunsInto = <T extends Uint32Array | Float64Array>(
  reader: BinaryReader,
  values: T,
  max: number,
): T | null => {
  const count = values.length;
  let filled = 0;
  while (filled < count) {
    const head = reader.readVarint();
    const length = Math.floor(head / 2);
    if (length === 0 || length > count - filled) {
      throw new Error(
        `Length run at event offset ${filled} has invalid length ${length}`,
      );
    }
    const end = filled + length;
    if (head % 2 === 0) {
      const value = reader.readVarint();
      if (value > max) {
        return null;
      }
      values.fill(value, filled, end);
      filled = end;
      continue;
    }
    if (length > reader.remainingByteLength) {
      throw new Error("Unexpected end of binary eg-walker graph");
    }
    for (; filled < end; filled++) {
      const value = reader.readVarint();
      if (value > max) {
        return null;
      }
      values[filled] = value;
    }
  }
  return values;
};

const readOperations = (
  reader: BinaryReader,
  count: number,
  lengths: PackedUnsignedIntegerColumn,
): OperationColumns => {
  const operationTypes = new Uint8Array(count);
  const insertStarts = new Uint32Array(count);
  const start = reader.position;
  const narrow = new Uint32Array(count);
  const narrowLength = readOperationSpansInto(
    reader,
    lengths,
    operationTypes,
    narrow,
    insertStarts,
    UINT32_MAX,
  );
  if (narrowLength >= 0) {
    return {
      operationTypes,
      operationIndexes: narrow,
      insertStarts,
      insertedLength: narrowLength,
    };
  }
  reader.rewind(start);
  const wide = new Float64Array(count);
  const insertedLength = readOperationSpansInto(
    reader,
    lengths,
    operationTypes,
    wide,
    insertStarts,
    Number.MAX_SAFE_INTEGER,
  );
  return {
    operationTypes,
    operationIndexes: wide,
    insertStarts,
    insertedLength,
  };
};

/**
 * Expand operation spans into per-event types, indexes and insert starts.
 * Returns the inserted text length, or `-1` when an index exceeds `max`.
 */
const readOperationSpansInto = (
  reader: BinaryReader,
  lengths: PackedUnsignedIntegerColumn,
  operationTypes: Uint8Array,
  indexes: Uint32Array | Float64Array,
  insertStarts: Uint32Array,
  max: number,
): number => {
  const count = indexes.length;
  let filled = 0;
  let cursor = 0;
  let inserted = 0;
  while (filled < count) {
    const head = reader.readVarint();
    const kind = head % 4;
    const length = (head - kind) / 4;
    if (length === 0 || length > count - filled) {
      throw new Error(
        `Operation span at event offset ${filled} has invalid length ${length}`,
      );
    }
    const anchor = unwrapAnchor(cursor, reader.readZigZagVarint());
    const end = filled + length;
    if (kind === EGW4_SPAN.INSERT) {
      let index = anchor;
      for (; filled < end; filled++) {
        if (index > max) {
          return -1;
        }
        operationTypes[filled] = PACKED_OPERATION_TYPE.INSERT;
        indexes[filled] = index;
        insertStarts[filled] = inserted;
        const eventLength = lengths[filled]!;
        index += eventLength;
        inserted += eventLength;
        if (!Number.isSafeInteger(index)) {
          throw new Error(`Invalid operation index at event offset ${filled}`);
        }
        if (inserted > UINT32_MAX) {
          throw new Error(
            "Inserted content exceeds packed UTF-16 offset range",
          );
        }
      }
      cursor = index;
    } else if (kind === EGW4_SPAN.DELETE) {
      if (anchor > max) {
        return -1;
      }
      operationTypes.fill(PACKED_OPERATION_TYPE.DELETE, filled, end);
      indexes.fill(anchor, filled, end);
      filled = end;
      cursor = anchor;
    } else if (kind === EGW4_SPAN.BACKSPACE) {
      let index = anchor;
      for (; filled < end; filled++) {
        index -= lengths[filled]!;
        if (index < 0) {
          throw new Error(`Invalid operation index at event offset ${filled}`);
        }
        if (index > max) {
          return -1;
        }
        operationTypes[filled] = PACKED_OPERATION_TYPE.DELETE;
        indexes[filled] = index;
      }
      cursor = index;
    } else {
      throw new Error(
        `Unknown operation span kind ${kind} at event offset ${filled}`,
      );
    }
  }
  return inserted;
};

const readInsertedContent = (
  reader: BinaryReader,
  operations: OperationColumns,
  lengths: PackedUnsignedIntegerColumn,
): string => {
  const expectedLength = operations.insertedLength;
  // lz4js allocates the whole destination up front and silently drops what
  // does not fit. Cap it at the most UTF-8 the declared UTF-16 length can
  // need (3 bytes per code unit) and at what the frame can expand to (an
  // LZ4 byte yields at most 255), then check the decoded length.
  const compressed = reader.readByteView(reader.readVarint());
  const maxBytes =
    Math.min(expectedLength * 3, compressed.length * LZ4_MAX_EXPANSION) + 64;
  const decompressed = toUint8Array(lz4.decompress(compressed, maxBytes));
  const content = decodeTextStrict(decompressed);
  if (content.length !== expectedLength) {
    throw new Error(
      `Decompressed inserted-content size mismatch (expected ${expectedLength} UTF-16 code units, got ${content.length})`,
    );
  }
  // Strict UTF-8 never decodes to a lone surrogate, so an insert's text is
  // well-formed unless its range splits a surrogate pair.
  const { operationTypes, insertStarts } = operations;
  for (let offset = 0; offset < operationTypes.length; offset++) {
    const length = lengths[offset]!;
    if (
      operationTypes[offset] !== PACKED_OPERATION_TYPE.INSERT ||
      length === 0
    ) {
      continue;
    }
    const start = insertStarts[offset]!;
    const first = content.charCodeAt(start);
    const last = content.charCodeAt(start + length - 1);
    if (
      (first >= 0xdc00 && first <= 0xdfff) ||
      (last >= 0xd800 && last <= 0xdbff)
    ) {
      throw new Error(
        `Insert text at event offset ${offset} is not well-formed UTF-16`,
      );
    }
  }
  return content;
};

/**
 * Delta segments into an `Int32Array`; values outside its range read the
 * column again into a `Float64Array`, kept as a `Uint32Array` when every
 * value fits one. These are the types the EGW3 decoder produced.
 */
const readTimestamps = (
  reader: BinaryReader,
  count: number,
): PackedIntegerColumn => {
  const start = reader.position;
  const narrow = readDeltaSegmentsInto(
    reader,
    new Int32Array(count),
    INT32_MIN,
    INT32_MAX,
  );
  if (narrow !== null) {
    return narrow;
  }
  reader.rewind(start);
  const wide = readDeltaSegmentsInto(
    reader,
    new Float64Array(count),
    -Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  )!;
  for (const value of wide) {
    if (value < 0 || value > UINT32_MAX) {
      return wide;
    }
  }
  return new Uint32Array(wide);
};

const readDeltaSegmentsInto = <T extends Int32Array | Float64Array>(
  reader: BinaryReader,
  values: T,
  min: number,
  max: number,
): T | null => {
  const count = values.length;
  let filled = 0;
  let previous = 0;
  let step = 0;
  while (filled < count) {
    const head = reader.readVarint();
    const mode = head % 4;
    const length = (head - mode) / 4;
    if (length === 0 || length > count - filled) {
      throw new Error(
        `Timestamp segment at event offset ${filled} has invalid length ${length}`,
      );
    }
    const end = filled + length;
    if (mode === EGW4_SEGMENT.LITERAL) {
      if (length > reader.remainingByteLength) {
        throw new Error("Unexpected end of binary eg-walker graph");
      }
      for (; filled < end; filled++) {
        const value = previous + reader.readZigZagVarint();
        if (value < min || value > max) {
          return outOfRange(value, filled);
        }
        values[filled] = value;
        previous = value;
      }
      continue;
    }
    if (mode !== EGW4_SEGMENT.SAME_STEP && mode !== EGW4_SEGMENT.NEW_STEP) {
      throw new Error(
        `Unknown timestamp segment mode ${mode} at event offset ${filled}`,
      );
    }
    const first = previous + reader.readZigZagVarint();
    if (mode === EGW4_SEGMENT.NEW_STEP) {
      step = reader.readZigZagVarint();
    }
    if (first < min || first > max) {
      return outOfRange(first, filled);
    }
    let value = first;
    values[filled++] = value;
    for (; filled < end; filled++) {
      value += step;
      values[filled] = value;
    }
    // A segment is monotonic, so its ends bound every value in it.
    if (value < min || value > max) {
      return outOfRange(value, end - 1);
    }
    previous = value;
  }
  return values;
};

/** `null` asks for a wider column; an unsafe value is invalid at any width. */
const outOfRange = (value: number, offset: number): null => {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid timestamp at event offset ${offset}`);
  }
  return null;
};

const readMetadata = (reader: BinaryReader): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readStrictString(reader));
  } catch {
    throw new Error("Invalid eg-walker columnar graph metadata");
  }
  return strictMetadata(parsed);
};
