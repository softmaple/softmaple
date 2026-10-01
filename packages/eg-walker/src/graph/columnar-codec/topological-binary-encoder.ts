import { OPERATION_TYPE } from "../../constants/operation-types";
import { assertWellFormedUtf16 } from "../../core/invariants";
import type { EventId, GraphEvent } from "../../types";
import { EventAlreadyExistsError } from "../event-graph-errors";
import { EventIdRunIndex } from "../internals/event-id-run-index";
import { encodeEgw4, Egw4IdRuns } from "./egw4-encoder";

export interface TopologicalEventGraphEncoding {
  readonly binary: Uint8Array;
  readonly frontier: ReadonlyArray<EventId>;
}

/**
 * Encode events that are already in the desired causal/topological wire order.
 *
 * This is the allocation-light persistence boundary for importers that already
 * produced a topological stream. It deliberately does not build an
 * {@link EventGraph}: validation, frontier reconstruction, and EGW4 column
 * emission are performed directly over the caller's immutable events. The
 * event order is significant and becomes the decoder's insertion order.
 *
 * The same topological order and metadata produce byte-for-byte the same
 * EGW4 payload as `ColumnarEventGraphCodec.encodeBinary(graph)`. The frontier
 * is not on the wire; `frontierOrder`, when supplied, only orders the
 * returned frontier, which is otherwise in the order events reached it.
 */
export const encodeTopologicallyOrderedEventsBinary = (
  events: ReadonlyArray<GraphEvent>,
  metadata: Readonly<Record<string, unknown>> = {},
  frontierOrder?: ReadonlyArray<EventId>,
): TopologicalEventGraphEncoding => {
  assertMetadata(metadata);

  const count = events.length;
  // Positions by ID, stored as ID runs: typing needs no per-event entry.
  const positions = new EventIdRunIndex();
  const hasChild = new Uint8Array(count);
  const isOverride = new Uint8Array(count);
  const insertedParts: string[] = [];
  const ids = new Egw4IdRuns();
  let overrideCount = 0;
  let previousId: EventId | undefined;

  for (let position = 0; position < count; position++) {
    const event = events[position]!;
    assertEvent(event, position);
    try {
      positions.append(event.id);
    } catch (error) {
      if (error instanceof EventAlreadyExistsError) {
        throw new Error(`Duplicate event ID ${event.id}`, { cause: error });
      }
      throw error;
    }

    const parents = event.parentVersion;
    if (
      previousId !== undefined &&
      parents.size === 1 &&
      parents.has(previousId)
    ) {
      hasChild[position - 1] = 1;
    } else {
      for (const parentId of parents) {
        const parentPosition = positions.localVersionOf(parentId, position);
        if (parentPosition < 0) {
          throw new Error(
            `Event ${event.id} is not in topological order: parent ${parentId} has not been encoded`,
          );
        }
        hasChild[parentPosition] = 1;
      }
      if (position > 0 || parents.size > 0) {
        isOverride[position] = 1;
        overrideCount++;
      }
    }

    if (event.operation.type === OPERATION_TYPE.INSERT) {
      insertedParts.push(event.operation.text);
    }
    ids.appendId(event.id);
    previousId = event.id;
  }

  // Events without children, in the order they were encoded.
  const frontier = new Set<EventId>();
  for (let position = 0; position < count; position++) {
    if (hasChild[position] === 0) {
      frontier.add(events[position]!.id);
    }
  }
  const frontierIds = resolveFrontierOrder(frontier, frontierOrder);
  // Parents of the override being written, as positions.
  let parentsPosition = -1;
  let parentPositions: number[] = [];
  const binary = encodeEgw4({
    columns: {
      count,
      isInsertAt: (position) =>
        events[position]!.operation.type === OPERATION_TYPE.INSERT,
      operationIndexAt: (position) => events[position]!.operation.index,
      operationLengthAt: (position) => {
        const operation = events[position]!.operation;
        return operation.type === OPERATION_TYPE.INSERT
          ? operation.text.length
          : operation.length;
      },
      timestampAt: (position) => events[position]!.timestamp,
      hasDefaultParentsAt: (position) => isOverride[position] === 0,
      parentCountAt: (position) => events[position]!.parentVersion.size,
      parentPositionAt: (position, parentIndex) => {
        if (position !== parentsPosition) {
          parentPositions = Array.from(
            events[position]!.parentVersion,
            (parentId) => positions.localVersionOf(parentId, position),
          );
          parentsPosition = position;
        }
        return parentPositions[parentIndex]!;
      },
    },
    ids,
    overrideCount,
    insertedText: insertedParts.join(""),
    metadata,
  });
  return { binary, frontier: frontierIds };
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
  const ids = new Egw4IdRuns();
  let overrideCount = 0;

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

    if (isInsert) {
      insertedParts.push(source.insertedTextAt(rank));
    }
    if (!usesDefaultParentRank(source, rank, position, rankAt)) {
      overrideCount++;
    }
    appendColumnId(ids, source, rank);
  }

  const frontierIds = resolveFrontierRanks(
    source,
    frontierRanks,
    positionOf,
    hasChild,
  );
  const binary = encodeEgw4({
    columns: {
      count,
      isInsertAt: (position) => source.isInsertAt(rankAt(position)),
      operationIndexAt: (position) => source.operationIndexAt(rankAt(position)),
      operationLengthAt: (position) =>
        source.operationLengthAt(rankAt(position)),
      timestampAt: (position) => source.timestampAt(rankAt(position)),
      hasDefaultParentsAt: (position) =>
        usesDefaultParentRank(source, rankAt(position), position, rankAt),
      parentCountAt: (position) => source.parentCountAt(rankAt(position)),
      parentPositionAt: (position, parentIndex) =>
        positionOf[source.parentRankAt(rankAt(position), parentIndex)]! - 1,
    },
    ids,
    overrideCount,
    insertedText: insertedParts.join(""),
    metadata,
  });
  return { binary, frontier: frontierIds };
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
  } else {
    const length = source.operationLengthAt(rank);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error(
        `Event ${source.idAt(rank)} has an invalid delete length`,
      );
    }
  }
  if (!Number.isSafeInteger(index + source.operationLengthAt(rank))) {
    throw operationEndError(source.idAt(rank));
  }
};

/** EGW4 derives indexes inside a span from the previous event's end. */
const operationEndError = (id: EventId): Error =>
  new Error(`Event ${id} operation ends beyond the safe integer range`);

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

const appendColumnId = (
  ids: Egw4IdRuns,
  source: TopologicalColumnSource,
  rank: number,
): void => {
  if (source.useStringIdAt(rank)) {
    ids.appendId(source.idAt(rank));
    return;
  }
  const agent = source.agentAt(rank);
  if (agent < 0) {
    ids.appendCustom(source.idAt(rank));
    return;
  }
  ids.appendCanonical(agent, source.agentName(agent), source.sequenceAt(rank));
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
    if (
      !Number.isSafeInteger(event.operation.index + event.operation.text.length)
    ) {
      throw operationEndError(event.id);
    }
    return;
  }
  if (event.operation.type === OPERATION_TYPE.DELETE) {
    if (
      !Number.isSafeInteger(event.operation.length) ||
      event.operation.length < 0
    ) {
      throw new Error(`Event ${event.id} has an invalid delete length`);
    }
    if (!Number.isSafeInteger(event.operation.index + event.operation.length)) {
      throw operationEndError(event.id);
    }
    return;
  }
  throw new Error(`Event ${event.id} has an unknown operation type`);
};
