/**
 * Functional columnar storage implementation
 * Using immutable data structures and pure functions
 */

import { Event, EventId, EventType } from "../../types";
import { partition, groupBy } from "../utils/array";
import { memoize } from "../utils/composition";

// ============ Types ============

interface EventSegment {
  readonly type: EventType;
  readonly startPosition: number;
  readonly count: number;
  readonly timestamps?: readonly number[];
}

interface EventIdRun {
  readonly replicaId: string;
  readonly startSeq: number;
  readonly count: number;
}

interface ParentException {
  readonly eventIndex: number;
  readonly parents: readonly EventId[];
}

interface ColumnarData {
  readonly segments: readonly EventSegment[];
  readonly content: string;
  readonly parentExceptions: readonly ParentException[];
  readonly eventIdRuns: readonly EventIdRun[];
  readonly finalDocument?: string;
}

// ============ Pure VarInt Functions ============

const validateNonNegative = (value: number): number => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `VarInt.encode: value must be a non-negative integer, got ${value}`,
    );
  }
  return value;
};

const encodeSingleVarInt = (value: number): number[] => {
  const validated = validateNonNegative(value);
  const bytes: number[] = [];
  let current = validated;

  while (current >= 0x80) {
    bytes.push((current & 0x7f) | 0x80);
    current >>>= 7;
  }
  bytes.push(current);
  return bytes;
};

export const encodeVarInt = (value: number): Uint8Array =>
  new Uint8Array(encodeSingleVarInt(value));

export const decodeVarInt = (
  buffer: Uint8Array,
  offset: number = 0,
): [number, number] => {
  let value = 0;
  let shift = 0;
  let byte: number;
  let currentOffset = offset;

  do {
    if (currentOffset >= buffer.length) {
      throw new Error("VarInt.decode: Unexpected end of buffer");
    }
    if (shift >= 53) {
      throw new Error("VarInt.decode: Value exceeds safe integer range");
    }

    byte = buffer[currentOffset++] ?? 0;
    value += (byte & 0x7f) * Math.pow(2, shift);
    shift += 7;
  } while (byte & 0x80);

  return [value, currentOffset];
};

// ============ Pure Compression Functions ============

const simpleCompress = (text: string): Uint8Array => {
  const encoded = new TextEncoder().encode(text);
  const runs: Array<{ char: number; count: number }> = [];

  if (encoded.length === 0) return new Uint8Array(0);

  let current = encoded[0] ?? 0;
  let count = 1;

  for (let i = 1; i < encoded.length; i++) {
    if (encoded[i] !== undefined && encoded[i] === current && count < 255) {
      count++;
    } else {
      runs.push({ char: current, count });
      const val = encoded[i];
      if (val !== undefined) {
        current = val;
      }
      count = 1;
    }
  }
  runs.push({ char: current, count });

  const result = new Uint8Array(runs.length * 2);
  runs.forEach((run, i) => {
    result[i * 2] = run.char;
    result[i * 2 + 1] = run.count;
  });

  return result;
};

const simpleDecompress = (compressed: Uint8Array): string => {
  const bytes: number[] = [];

  for (let i = 0; i < compressed.length; i += 2) {
    const char = compressed[i] ?? 0;
    // Treat 0 as valid count, only use 1 as default if undefined
    const rawCount = compressed[i + 1];
    const count = rawCount !== undefined ? rawCount : 1;
    if (count >= 0) {
      for (let j = 0; j < count; j++) {
        bytes.push(char);
      }
    }
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
};

// ============ Pure Event Processing Functions ============

const sortEventsByTopology = (events: readonly Event[]): Event[] => {
  // Kahn's algorithm for topological sort
  const eventMap = new Map(events.map((e) => [e.id, e]));
  const sorted: Event[] = [];
  const visited = new Set<EventId>();
  const visiting = new Set<EventId>();

  const visit = (id: EventId): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      // Cycle detected, skip this event
      return;
    }

    visiting.add(id);
    const event = eventMap.get(id);
    if (event) {
      // Visit all parents first
      for (const parentId of event.parentVersion) {
        if (eventMap.has(parentId)) {
          visit(parentId);
        }
      }
      sorted.push(event);
    }
    visiting.delete(id);
    visited.add(id);
  };

  // Visit all events
  for (const event of events) {
    visit(event.id);
  }

  return sorted;
};

const extractSegments = (events: readonly Event[]): EventSegment[] => {
  const TIMESTAMP_MISSING = -1; // Deterministic sentinel value

  if (events.length === 0) return [];

  const firstEvent = events[0];
  if (!firstEvent) return [];

  const segments: EventSegment[] = [];
  let currentSegment = {
    type: firstEvent.type,
    startPosition: firstEvent.position,
    count: 1,
    timestamps: [firstEvent.timestamp ?? TIMESTAMP_MISSING],
  };

  for (let i = 1; i < events.length; i++) {
    const event = events[i];
    if (!event) continue;

    const isConsecutive =
      event.type === currentSegment.type &&
      event.position === currentSegment.startPosition + currentSegment.count;

    if (isConsecutive) {
      currentSegment = {
        ...currentSegment,
        count: currentSegment.count + 1,
        timestamps: [
          ...(currentSegment.timestamps ?? []),
          event.timestamp ?? TIMESTAMP_MISSING,
        ],
      };
    } else {
      segments.push(currentSegment);
      currentSegment = {
        type: event.type,
        startPosition: event.position,
        count: 1,
        timestamps: [event.timestamp ?? TIMESTAMP_MISSING],
      };
    }
  }

  segments.push(currentSegment);
  return segments;
};

const extractContent = (events: readonly Event[]): string =>
  events
    .filter((e) => e.type === EventType.INSERT)
    .map((e) => e.content || "")
    .join("");

const extractParentExceptions = (
  events: readonly Event[],
): ParentException[] => {
  const exceptions: ParentException[] = [];

  events.forEach((event, index) => {
    const expectedParent = index > 0 ? events[index - 1]?.id : null;
    const actualParents = Array.from(event.parentVersion);

    const isException =
      actualParents.length !== 1 ||
      (actualParents.length === 1 && actualParents[0] !== expectedParent);

    if (isException) {
      exceptions.push({
        eventIndex: index,
        parents: actualParents,
      });
    }
  });

  return exceptions;
};

const extractEventIdRuns = (events: readonly Event[]): EventIdRun[] => {
  if (events.length === 0) return [];

  const firstEvent = events[0];
  if (!firstEvent) return [];

  const runs: EventIdRun[] = [];
  const parseEventId = (id: EventId): { replica: string; seq: number } => {
    const parts = id.split("-");
    const seqStr = parts[parts.length - 1];
    return {
      replica: parts.slice(0, -1).join("-"),
      seq: parseInt(seqStr ?? "0", 10),
    };
  };

  let current = parseEventId(firstEvent.id);
  let runStart = current;
  let count = 1;

  for (let i = 1; i < events.length; i++) {
    const event = events[i];
    if (!event) continue;

    const parsed = parseEventId(event.id);

    if (parsed.replica === current.replica && parsed.seq === current.seq + 1) {
      current = parsed;
      count++;
    } else {
      runs.push({
        replicaId: runStart.replica,
        startSeq: runStart.seq,
        count,
      });
      runStart = parsed;
      current = parsed;
      count = 1;
    }
  }

  runs.push({
    replicaId: runStart.replica,
    startSeq: runStart.seq,
    count,
  });

  return runs;
};

// ============ Main Serialization Functions ============

export const serializeEvents = (
  events: readonly Event[],
  finalDocument?: string,
): Uint8Array => {
  const sortedEvents = sortEventsByTopology(events);

  const data: ColumnarData = {
    segments: extractSegments(sortedEvents),
    content: extractContent(sortedEvents),
    parentExceptions: extractParentExceptions(sortedEvents),
    eventIdRuns: extractEventIdRuns(sortedEvents),
    finalDocument,
  };

  return serializeColumnarData(data);
};

const serializeColumnarData = (data: ColumnarData): Uint8Array => {
  // For simplicity, using JSON. In production, use proper binary format
  const json = JSON.stringify(data);
  const compressed = simpleCompress(json);

  const header = new Uint8Array([0x45, 0x47]); // "EG" magic bytes
  const version = new Uint8Array([0x01]); // Version 1
  const sizeBytes = encodeVarInt(compressed.length);

  const result = new Uint8Array(
    header.length + version.length + sizeBytes.length + compressed.length,
  );

  let offset = 0;
  result.set(header, offset);
  offset += header.length;
  result.set(version, offset);
  offset += version.length;
  result.set(sizeBytes, offset);
  offset += sizeBytes.length;
  result.set(compressed, offset);

  return result;
};

export const deserializeEvents = (
  buffer: Uint8Array,
): { events: Event[]; finalDocument?: string } => {
  // Validate header
  if (buffer[0] !== 0x45 || buffer[1] !== 0x47) {
    throw new Error("Invalid columnar storage format");
  }

  const version = buffer[2];
  if (version !== 0x01) {
    throw new Error(`Unsupported version: ${version}`);
  }

  const [compressedSize, dataOffset] = decodeVarInt(buffer, 3);
  const compressed = buffer.slice(dataOffset, dataOffset + compressedSize);
  const json = simpleDecompress(compressed);
  const data: ColumnarData = JSON.parse(json);

  return {
    events: reconstructEvents(data),
    finalDocument: data.finalDocument,
  };
};

const reconstructEvents = (data: ColumnarData): Event[] => {
  const events: Event[] = [];
  let contentOffset = 0;
  let currentRunIndex = 0;
  let currentRunOffset = 0;
  let globalEventIndex = 0;

  const contentChars = data.content.split("");

  data.segments.forEach((segment, segmentIndex) => {
    for (let i = 0; i < segment.count; i++) {
      const run = data.eventIdRuns[currentRunIndex];
      if (!run) {
        throw new Error(`Missing event ID run at index ${currentRunIndex}`);
      }

      const eventId = `${run.replicaId}-${run.startSeq + currentRunOffset}`;

      const parentException = data.parentExceptions.find(
        (exc) => exc.eventIndex === globalEventIndex,
      );

      const parentVersion = parentException
        ? new Set(parentException.parents)
        : globalEventIndex > 0
          ? new Set([events[globalEventIndex - 1]?.id || ("" as EventId)])
          : new Set<EventId>();

      const TIMESTAMP_MISSING = -1; // Use the same sentinel value
      const timestamp = segment.timestamps?.[i] ?? TIMESTAMP_MISSING;

      events.push({
        id: eventId,
        type: segment.type,
        position: segment.startPosition + i,
        content:
          segment.type === EventType.INSERT
            ? contentChars[contentOffset++]
            : undefined,
        parentVersion,
        timestamp,
      });

      currentRunOffset++;
      if (currentRunOffset >= run.count) {
        currentRunIndex++;
        currentRunOffset = 0;
      }

      globalEventIndex++;
    }
  });

  return events;
};

// ============ Storage Statistics ============

// Custom key generator for memoization that handles Sets correctly
const createEventCacheKey = (events: readonly Event[]): string => {
  const plainEvents = events.map((e) => ({
    id: e.id,
    type: e.type,
    position: e.position,
    content: e.content,
    parentVersion: Array.from(e.parentVersion).sort(), // Convert Set to sorted array
    timestamp: e.timestamp,
  }));
  return JSON.stringify(plainEvents);
};

export const calculateStorageStats = (events: readonly Event[]) => {
  const sortedEvents = sortEventsByTopology(events);
  const segments = extractSegments(sortedEvents);
  const content = extractContent(sortedEvents);
  const parentExceptions = extractParentExceptions(sortedEvents);
  const eventIdRuns = extractEventIdRuns(sortedEvents);

  return {
    totalEvents: events.length,
    segments: segments.length,
    contentLength: content.length,
    parentExceptions: parentExceptions.length,
    eventIdRuns: eventIdRuns.length,
    compressionRatio: calculateCompressionRatio(events, segments),
  };
};

const calculateCompressionRatio = (
  events: readonly Event[],
  segments: readonly EventSegment[],
): number => {
  if (events.length === 0) return 1;
  return events.length / segments.length;
};
