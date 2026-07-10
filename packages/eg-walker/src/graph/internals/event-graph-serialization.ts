import { OPERATION_TYPE } from "../../constants/operation-types";
import type {
  EventId,
  ExternalOperation,
  GraphEvent,
  SerializedGraphInput,
} from "../../types";
import { compareEventIds } from "../event-id";
import { MaxHeap } from "./max-heap";

interface MutableEventGraph {
  addEvent(event: GraphEvent): void;
  setMetadata(metadata: Record<string, unknown>): void;
}

export const normalizeEventIds = (
  value: unknown,
  context: string = "event version",
): EventId[] => {
  if (!Array.isArray(value) && !(value instanceof Set)) {
    throw new Error(`${context} must be an array or Set of event IDs`);
  }
  const result: EventId[] = [];
  const seen = new Set<EventId>();
  for (const id of value as Iterable<unknown>) {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`${context} contains a non-string event ID`);
    }
    if (seen.has(id)) {
      throw new Error(`${context} contains duplicate event ID ${id}`);
    }
    seen.add(id);
    result.push(id);
  }
  return result;
};

export const deserializeEventGraph = <TGraph extends MutableEventGraph>(
  data: SerializedGraphInput,
  createGraph: () => TGraph,
): TGraph => {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Cannot deserialize event graph: expected an object");
  }
  const input = data as unknown as Record<string, unknown>;
  if (!Array.isArray(input.events)) {
    throw new Error("Cannot deserialize event graph: events must be an array");
  }
  normalizeEventIds(input.version, "serialized graph version");
  if (
    input.metadata !== undefined &&
    (input.metadata === null ||
      typeof input.metadata !== "object" ||
      Array.isArray(input.metadata))
  ) {
    throw new Error(
      "Cannot deserialize event graph: metadata must be an object",
    );
  }

  const graph = createGraph();
  if (input.metadata !== undefined) {
    graph.setMetadata({ ...(input.metadata as Record<string, unknown>) });
  }

  const eventsById = new Map<EventId, GraphEvent>();
  const remainingParents = new Map<EventId, number>();
  const childrenIndex = new Map<EventId, EventId[]>();

  for (let index = 0; index < input.events.length; index++) {
    const event = normalizeSerializedEvent(input.events[index], index);
    if (eventsById.has(event.id)) {
      throw new Error(
        `Cannot deserialize event graph with duplicate event id: ${event.id}`,
      );
    }
    eventsById.set(event.id, event);
    remainingParents.set(event.id, event.parentVersion.size);
    for (const parentId of event.parentVersion) {
      const list = childrenIndex.get(parentId) ?? [];
      list.push(event.id);
      childrenIndex.set(parentId, list);
    }
  }

  const ready = new MaxHeap<EventId>((left, right) =>
    compareEventIds(right, left),
  );
  for (const [id, count] of remainingParents) {
    if (count === 0) {
      ready.push(id);
    }
  }

  let added = 0;
  while (ready.size > 0) {
    const id = ready.pop()!;
    const event = eventsById.get(id);
    if (!event) {
      continue;
    }
    graph.addEvent(event);
    added++;

    for (const childId of childrenIndex.get(id) ?? []) {
      const remaining = (remainingParents.get(childId) ?? 0) - 1;
      remainingParents.set(childId, remaining);
      if (remaining === 0) {
        ready.push(childId);
      }
    }
  }

  if (added !== eventsById.size) {
    const missingParents = new Set<EventId>();
    for (const event of eventsById.values()) {
      for (const parentId of event.parentVersion) {
        if (!eventsById.has(parentId)) {
          missingParents.add(parentId);
        }
      }
    }
    if (missingParents.size > 0) {
      throw new Error(
        `Cannot deserialize event graph with missing parents: ${[
          ...missingParents,
        ].join(", ")}`,
      );
    }
    throw new Error(
      "Cannot deserialize event graph: cycle or unresolvable ordering detected",
    );
  }

  return graph;
};

const normalizeSerializedEvent = (
  value: unknown,
  index: number,
): GraphEvent => {
  if (value === null || typeof value !== "object") {
    throw new Error(`serialized event ${index} must be an object`);
  }
  const event = value as Record<string, unknown>;
  if (typeof event.id !== "string" || event.id.length === 0) {
    throw new Error(`serialized event ${index} id must be a non-empty string`);
  }
  if (
    typeof event.timestamp !== "number" ||
    !Number.isFinite(event.timestamp)
  ) {
    throw new Error(`serialized event ${event.id} has an invalid timestamp`);
  }
  return {
    id: event.id,
    operation: normalizeOperation(event.operation, event.id),
    parentVersion: new Set(
      normalizeEventIds(
        event.parentVersion,
        `serialized event ${event.id} parents`,
      ),
    ),
    timestamp: event.timestamp,
  };
};

const normalizeOperation = (
  value: unknown,
  eventId: EventId,
): ExternalOperation => {
  if (value === null || typeof value !== "object") {
    throw new Error(`serialized event ${eventId} has an invalid operation`);
  }
  const operation = value as Record<string, unknown>;
  if (
    typeof operation.index !== "number" ||
    !Number.isSafeInteger(operation.index) ||
    operation.index < 0
  ) {
    throw new Error(
      `serialized event ${eventId} has an invalid operation index`,
    );
  }
  if (operation.type === OPERATION_TYPE.INSERT) {
    if (typeof operation.text !== "string") {
      throw new Error(`serialized event ${eventId} has an invalid insert text`);
    }
    return {
      type: OPERATION_TYPE.INSERT,
      index: operation.index,
      text: operation.text,
    };
  }
  if (operation.type === OPERATION_TYPE.DELETE) {
    if (
      typeof operation.length !== "number" ||
      !Number.isSafeInteger(operation.length) ||
      operation.length < 0
    ) {
      throw new Error(
        `serialized event ${eventId} has an invalid delete length`,
      );
    }
    return {
      type: OPERATION_TYPE.DELETE,
      index: operation.index,
      length: operation.length,
    };
  }
  throw new Error(`serialized event ${eventId} has an unknown operation type`);
};
