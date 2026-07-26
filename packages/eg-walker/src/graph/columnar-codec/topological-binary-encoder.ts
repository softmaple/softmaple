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
 * For the same topological order and metadata, this produces byte-for-byte the
 * same EGW3 payload as `ColumnarEventGraphCodec.encodeBinary(graph)`, while
 * avoiding copied `GraphEvent`/`Set` objects and full per-event column arrays.
 */
export const encodeTopologicallyOrderedEventsBinary = (
  events: ReadonlyArray<GraphEvent>,
  metadata: Readonly<Record<string, unknown>> = {},
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
  const frontierIds = Array.from(frontier);
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
