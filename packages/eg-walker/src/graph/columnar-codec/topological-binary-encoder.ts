import lz4 from "lz4js";

import { OPERATION_TYPE } from "../../constants/operation-types";
import { assertWellFormedUtf16 } from "../../core/invariants";
import type { EventId, GraphEvent } from "../../types";
import { parseEventId } from "../event-id";
import { BINARY_MAGIC, BinaryWriter, encodeText } from "../internals/binary-io";

export interface TopologicalEventGraphEncoding {
  readonly binary: Uint8Array;
  readonly frontier: ReadonlyArray<EventId>;
}

interface IdRunState {
  readonly replicaId: string;
  readonly startSequence: number;
  length: number;
  readonly custom: boolean;
}

/**
 * Encode events that are already in the desired causal/topological wire order.
 *
 * This is the allocation-light persistence boundary for importers that already
 * produced a topological stream. It deliberately does not build an
 * {@link EventGraph}: validation, frontier reconstruction, and EGW3 column
 * emission are performed directly over the caller's immutable events. The
 * event order is significant and becomes the decoder's insertion order.
 *
 * When the source graph's frontier order is supplied, the same topological
 * order and metadata produce byte-for-byte the same EGW3 payload as
 * `ColumnarEventGraphCodec.encodeBinary(graph)`. Without it, the frontier order
 * is reconstructed from the event stream.
 */
export const encodeTopologicallyOrderedEventsBinary = (
  events: ReadonlyArray<GraphEvent>,
  metadata: Readonly<Record<string, unknown>> = {},
  frontierOrder?: ReadonlyArray<EventId>,
): TopologicalEventGraphEncoding => {
  assertMetadata(metadata);

  const seen = new Set<EventId>();
  const frontier = new Set<EventId>();
  const insertedParts: string[] = [];
  let operationRunCount = 0;
  let parentOverrideCount = 0;
  let previousType: GraphEvent["operation"]["type"] | undefined;
  let previousId: EventId | undefined;
  const idRuns: IdRunState[] = [];

  for (let eventOffset = 0; eventOffset < events.length; eventOffset++) {
    const event = events[eventOffset]!;
    assertEvent(event, eventOffset);
    if (seen.has(event.id)) {
      throw new Error(`Duplicate event ID ${event.id}`);
    }

    for (const parentId of event.parentVersion) {
      if (!seen.has(parentId)) {
        throw new Error(
          `Event ${event.id} is not in topological order: parent ${parentId} has not been encoded`,
        );
      }
      frontier.delete(parentId);
    }
    seen.add(event.id);
    frontier.add(event.id);

    if (event.operation.type !== previousType) {
      operationRunCount++;
      previousType = event.operation.type;
    }
    if (event.operation.type === OPERATION_TYPE.INSERT) {
      insertedParts.push(event.operation.text);
    }

    if (!usesDefaultParent(event, eventOffset, previousId)) {
      parentOverrideCount++;
    }

    appendIdRun(idRuns, event.id);
    previousId = event.id;
  }

  const writer = new BinaryWriter();
  writer.writeBytes(BINARY_MAGIC);
  const frontierIds = resolveFrontierOrder(frontier, frontierOrder);
  writer.writeStringArray(frontierIds);
  writeOperationRuns(writer, events, operationRunCount);
  writeOperationIndexes(writer, events);
  writeOperationLengths(writer, events);
  writer.writeBytes(lz4.compress(encodeText(insertedParts.join(""))));
  writeParentOverrides(writer, events, parentOverrideCount);
  writeIdRuns(writer, idRuns);
  writeTimestamps(writer, events);
  writer.writeString(JSON.stringify(metadata));

  return { binary: writer.toUint8Array(), frontier: frontierIds };
};

/**
 * Per-rank columns of an event graph, read without materializing events.
 *
 * `agentAt` is non-negative exactly when the rank's ID is a canonical
 * `replicaId:sequence` ID, in which case `agentName(agentAt)` and
 * `sequenceAt` spell it; `useStringIdAt` routes ranks whose stored columns
 * cannot be trusted for that through {@link parseEventId} instead.
 */
export interface TopologicalColumnSource {
  readonly count: number;
  idAt(rank: number): EventId;
  agentAt(rank: number): number;
  agentName(agent: number): string;
  sequenceAt(rank: number): number;
  useStringIdAt(rank: number): boolean;
  isInsertAt(rank: number): boolean;
  operationIndexAt(rank: number): number;
  operationLengthAt(rank: number): number;
  insertedTextAt(rank: number): string;
  timestampAt(rank: number): number;
  parentCountAt(rank: number): number;
  parentRankAt(rank: number, parentIndex: number): number;
}

/**
 * Encode a graph's columns in `order` (ranks; `null` is insertion order).
 *
 * Produces byte-for-byte the output of
 * {@link encodeTopologicallyOrderedEventsBinary} over the same events in the
 * same order, with the same validation, but never builds a `GraphEvent`,
 * parent `Set` or per-event ID string for canonical IDs.
 */
export const encodeTopologicalColumnsBinary = (
  source: TopologicalColumnSource,
  order: Uint32Array | null,
  metadata: Readonly<Record<string, unknown>>,
  frontierRanks: ReadonlyArray<number>,
): TopologicalEventGraphEncoding => {
  assertMetadata(metadata);
  const count = source.count;
  if (order !== null && order.length !== count) {
    throw new Error("Topological order does not cover every event");
  }
  const rankAt = (position: number): number =>
    order === null ? position : order[position]!;

  // position + 1 of each visited rank; 0 while unvisited.
  const positionOf = new Uint32Array(count);
  const hasChild = new Uint8Array(count);
  const insertedParts: string[] = [];
  const idRuns: IdRunState[] = [];
  let operationRunCount = 0;
  let parentOverrideCount = 0;
  let previousInsert: boolean | undefined;

  for (let position = 0; position < count; position++) {
    const rank = rankAt(position);
    if (positionOf[rank] !== 0) {
      throw new Error(`Duplicate event ID ${source.idAt(rank)}`);
    }
    const isInsert = source.isInsertAt(rank);
    assertColumnEvent(source, rank, isInsert);

    const parentCount = source.parentCountAt(rank);
    for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
      const parentRank = source.parentRankAt(rank, parentIndex);
      if (positionOf[parentRank] === 0) {
        throw new Error(
          `Event ${source.idAt(rank)} is not in topological order: parent ${source.idAt(parentRank)} has not been encoded`,
        );
      }
      hasChild[parentRank] = 1;
    }
    positionOf[rank] = position + 1;

    if (isInsert !== previousInsert) {
      operationRunCount++;
      previousInsert = isInsert;
    }
    if (isInsert) {
      insertedParts.push(source.insertedTextAt(rank));
    }
    if (!usesDefaultParentRank(source, rank, position, rankAt)) {
      parentOverrideCount++;
    }
    appendColumnIdRun(idRuns, source, rank);
  }

  const writer = new BinaryWriter();
  writer.writeBytes(BINARY_MAGIC);
  const frontierIds = resolveFrontierRanks(
    source,
    frontierRanks,
    positionOf,
    hasChild,
  );
  writer.writeStringArray(frontierIds);

  writer.writeVarint(operationRunCount);
  let runStart = 0;
  for (let position = 1; position <= count; position++) {
    const previous = source.isInsertAt(rankAt(position - 1));
    if (position < count && source.isInsertAt(rankAt(position)) === previous) {
      continue;
    }
    writer.writeVarint(previous ? 1 : 2);
    writer.writeVarint(position - runStart);
    runStart = position;
  }

  writer.writeVarint(count);
  let previousIndex = 0;
  for (let position = 0; position < count; position++) {
    const index = source.operationIndexAt(rankAt(position));
    writer.writeZigZagVarint(index - previousIndex);
    previousIndex = index;
  }

  writer.writeVarint(count);
  for (let position = 0; position < count; position++) {
    writer.writeVarint(source.operationLengthAt(rankAt(position)));
  }

  writer.writeBytes(lz4.compress(encodeText(insertedParts.join(""))));

  writer.writeVarint(parentOverrideCount);
  let previousOverride = -1;
  for (let position = 0; position < count; position++) {
    const rank = rankAt(position);
    if (usesDefaultParentRank(source, rank, position, rankAt)) {
      continue;
    }
    writer.writeVarint(position - previousOverride - 1);
    const parentCount = source.parentCountAt(rank);
    const parentIds: EventId[] = [];
    for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
      parentIds.push(source.idAt(source.parentRankAt(rank, parentIndex)));
    }
    writer.writeStringArray(parentIds);
    previousOverride = position;
  }

  writeIdRuns(writer, idRuns);

  writer.writeVarint(count);
  let previousTimestamp = 0;
  for (let position = 0; position < count; position++) {
    const timestamp = source.timestampAt(rankAt(position));
    writer.writeZigZagVarint(timestamp - previousTimestamp);
    previousTimestamp = timestamp;
  }
  writer.writeString(JSON.stringify(metadata));

  return { binary: writer.toUint8Array(), frontier: frontierIds };
};

const assertColumnEvent = (
  source: TopologicalColumnSource,
  rank: number,
  isInsert: boolean,
): void => {
  if (!Number.isSafeInteger(source.timestampAt(rank))) {
    throw new Error(`Event ${source.idAt(rank)} has an invalid timestamp`);
  }
  const index = source.operationIndexAt(rank);
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(
      `Event ${source.idAt(rank)} has an invalid operation index`,
    );
  }
  if (isInsert) {
    assertWellFormedUtf16(
      source.insertedTextAt(rank),
      `Event ${source.idAt(rank)} insert text`,
    );
    return;
  }
  const length = source.operationLengthAt(rank);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(`Event ${source.idAt(rank)} has an invalid delete length`);
  }
};

const usesDefaultParentRank = (
  source: TopologicalColumnSource,
  rank: number,
  position: number,
  rankAt: (position: number) => number,
): boolean => {
  const parentCount = source.parentCountAt(rank);
  return position === 0
    ? parentCount === 0
    : parentCount === 1 &&
        source.parentRankAt(rank, 0) === rankAt(position - 1);
};

const appendColumnIdRun = (
  runs: IdRunState[],
  source: TopologicalColumnSource,
  rank: number,
): void => {
  if (source.useStringIdAt(rank)) {
    appendIdRun(runs, source.idAt(rank));
    return;
  }
  const agent = source.agentAt(rank);
  if (agent < 0) {
    runs.push({
      replicaId: source.idAt(rank),
      startSequence: 0,
      length: 1,
      custom: true,
    });
    return;
  }
  const replicaId = source.agentName(agent);
  const sequence = source.sequenceAt(rank);
  const previous = runs[runs.length - 1];
  if (
    previous !== undefined &&
    !previous.custom &&
    previous.replicaId === replicaId &&
    previous.startSequence + previous.length === sequence
  ) {
    previous.length++;
    return;
  }
  runs.push({ replicaId, startSequence: sequence, length: 1, custom: false });
};

const resolveFrontierRanks = (
  source: TopologicalColumnSource,
  frontierRanks: ReadonlyArray<number>,
  positionOf: Uint32Array,
  hasChild: Uint8Array,
): EventId[] => {
  let childless = 0;
  for (let rank = 0; rank < hasChild.length; rank++) {
    if (hasChild[rank] === 0) childless++;
  }
  const seen = new Set<number>();
  for (const rank of frontierRanks) {
    if (
      !Number.isInteger(rank) ||
      rank < 0 ||
      rank >= hasChild.length ||
      positionOf[rank] === 0 ||
      hasChild[rank] !== 0 ||
      seen.has(rank)
    ) {
      throw new Error("Supplied frontier order does not match event frontier");
    }
    seen.add(rank);
  }
  if (seen.size !== childless) {
    throw new Error("Supplied frontier order does not match event frontier");
  }
  return frontierRanks.map((rank) => source.idAt(rank));
};

const resolveFrontierOrder = (
  frontier: ReadonlySet<EventId>,
  frontierOrder: ReadonlyArray<EventId> | undefined,
): EventId[] => {
  if (frontierOrder === undefined) {
    return Array.from(frontier);
  }

  const ordered = new Set<EventId>();
  for (const eventId of frontierOrder as ReadonlyArray<unknown>) {
    if (
      typeof eventId !== "string" ||
      !frontier.has(eventId) ||
      ordered.has(eventId)
    ) {
      throw new Error("Supplied frontier order does not match event frontier");
    }
    ordered.add(eventId);
  }
  if (ordered.size !== frontier.size) {
    throw new Error("Supplied frontier order does not match event frontier");
  }
  return Array.from(ordered);
};

const assertMetadata = (metadata: Readonly<Record<string, unknown>>): void => {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    throw new Error("Columnar graph metadata must be an object");
  }
};

const assertEvent = (event: GraphEvent, eventOffset: number): void => {
  if (event === null || typeof event !== "object") {
    throw new Error(`Event at offset ${eventOffset} must be an object`);
  }
  if (typeof event.id !== "string" || event.id.length === 0) {
    throw new Error(`Event at offset ${eventOffset} has an invalid ID`);
  }
  if (!(event.parentVersion instanceof Set)) {
    throw new Error(`Event ${event.id} parentVersion must be a Set`);
  }
  for (const parentId of event.parentVersion as ReadonlySet<unknown>) {
    if (typeof parentId !== "string" || parentId.length === 0) {
      throw new Error(`Event ${event.id} has an invalid parent ID`);
    }
  }
  if (!Number.isSafeInteger(event.timestamp)) {
    throw new Error(`Event ${event.id} has an invalid timestamp`);
  }
  if (event.operation === null || typeof event.operation !== "object") {
    throw new Error(`Event ${event.id} has an invalid operation`);
  }
  if (
    !Number.isSafeInteger(event.operation.index) ||
    event.operation.index < 0
  ) {
    throw new Error(`Event ${event.id} has an invalid operation index`);
  }
  if (event.operation.type === OPERATION_TYPE.INSERT) {
    if (typeof event.operation.text !== "string") {
      throw new Error(`Event ${event.id} has invalid insert text`);
    }
    assertWellFormedUtf16(
      event.operation.text,
      `Event ${event.id} insert text`,
    );
    return;
  }
  if (event.operation.type === OPERATION_TYPE.DELETE) {
    if (
      !Number.isSafeInteger(event.operation.length) ||
      event.operation.length < 0
    ) {
      throw new Error(`Event ${event.id} has an invalid delete length`);
    }
    return;
  }
  throw new Error(`Event ${event.id} has an unknown operation type`);
};

const usesDefaultParent = (
  event: GraphEvent,
  eventOffset: number,
  previousId: EventId | undefined,
): boolean =>
  eventOffset === 0
    ? event.parentVersion.size === 0
    : event.parentVersion.size === 1 &&
      previousId !== undefined &&
      event.parentVersion.has(previousId);

const writeOperationRuns = (
  writer: BinaryWriter,
  events: ReadonlyArray<GraphEvent>,
  runCount: number,
): void => {
  writer.writeVarint(runCount);
  let runStart = 0;
  for (let eventOffset = 1; eventOffset <= events.length; eventOffset++) {
    const previous = events[eventOffset - 1];
    const next = events[eventOffset];
    if (
      previous === undefined ||
      next?.operation.type === previous.operation.type
    ) {
      continue;
    }
    writer.writeVarint(
      previous.operation.type === OPERATION_TYPE.INSERT ? 1 : 2,
    );
    writer.writeVarint(eventOffset - runStart);
    runStart = eventOffset;
  }
};

const writeOperationIndexes = (
  writer: BinaryWriter,
  events: ReadonlyArray<GraphEvent>,
): void => {
  writer.writeVarint(events.length);
  let previous = 0;
  for (const event of events) {
    writer.writeZigZagVarint(event.operation.index - previous);
    previous = event.operation.index;
  }
};

const writeOperationLengths = (
  writer: BinaryWriter,
  events: ReadonlyArray<GraphEvent>,
): void => {
  writer.writeVarint(events.length);
  for (const event of events) {
    writer.writeVarint(
      event.operation.type === OPERATION_TYPE.INSERT
        ? event.operation.text.length
        : event.operation.length,
    );
  }
};

const writeParentOverrides = (
  writer: BinaryWriter,
  events: ReadonlyArray<GraphEvent>,
  overrideCount: number,
): void => {
  writer.writeVarint(overrideCount);
  let previousOverrideOffset = -1;
  for (let eventOffset = 0; eventOffset < events.length; eventOffset++) {
    const event = events[eventOffset]!;
    const previousId = events[eventOffset - 1]?.id;
    if (usesDefaultParent(event, eventOffset, previousId)) {
      continue;
    }
    writer.writeVarint(eventOffset - previousOverrideOffset - 1);
    writer.writeStringArray(Array.from(event.parentVersion));
    previousOverrideOffset = eventOffset;
  }
};

const appendIdRun = (runs: IdRunState[], id: EventId): void => {
  const parsed = parseEventId(id);
  const previous = runs[runs.length - 1];
  if (
    parsed !== null &&
    previous !== undefined &&
    !previous.custom &&
    previous.replicaId === parsed.replicaId &&
    previous.startSequence + previous.length === parsed.sequence
  ) {
    previous.length++;
    return;
  }
  runs.push(
    parsed === null
      ? { replicaId: id, startSequence: 0, length: 1, custom: true }
      : {
          replicaId: parsed.replicaId,
          startSequence: parsed.sequence,
          length: 1,
          custom: false,
        },
  );
};

const writeIdRuns = (
  writer: BinaryWriter,
  runs: ReadonlyArray<IdRunState>,
): void => {
  writer.writeVarint(runs.length);
  for (const run of runs) {
    writer.writeString(run.replicaId);
    writer.writeVarint(run.startSequence);
    writer.writeVarint(run.length * 2 + (run.custom ? 1 : 0));
  }
};

const writeTimestamps = (
  writer: BinaryWriter,
  events: ReadonlyArray<GraphEvent>,
): void => {
  writer.writeVarint(events.length);
  let previous = 0;
  for (const event of events) {
    writer.writeZigZagVarint(event.timestamp - previous);
    previous = event.timestamp;
  }
};
