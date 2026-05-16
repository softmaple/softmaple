import type { EventId, GraphEvent, SerializedGraphInput } from "../../types";

interface MutableEventGraph {
  addEvent(event: GraphEvent): void;
  setMetadata(metadata: Record<string, unknown>): void;
}

export const normalizeEventIds = (value: unknown): EventId[] => {
  if (Array.isArray(value)) {
    return value.filter((id): id is EventId => typeof id === "string");
  }

  if (value instanceof Set) {
    return Array.from(value).filter(
      (id): id is EventId => typeof id === "string",
    );
  }

  if (value && typeof value === "object") {
    const maybeIterable = value as { [Symbol.iterator]?: unknown };
    if (typeof maybeIterable[Symbol.iterator] === "function") {
      return Array.from(value as Iterable<unknown>).filter(
        (id): id is EventId => typeof id === "string",
      );
    }
  }

  return [];
};

export const deserializeEventGraph = <TGraph extends MutableEventGraph>(
  data: SerializedGraphInput,
  createGraph: () => TGraph,
): TGraph => {
  const graph = createGraph();

  if (data.metadata) {
    graph.setMetadata(data.metadata);
  }

  const eventsById = new Map<EventId, GraphEvent>();
  const remainingParents = new Map<EventId, number>();
  const childrenIndex = new Map<EventId, EventId[]>();

  for (const incoming of data.events) {
    const event: GraphEvent = {
      id: incoming.id,
      operation: incoming.operation,
      parentVersion: new Set(normalizeEventIds(incoming.parentVersion)),
      timestamp: incoming.timestamp,
    };
    eventsById.set(event.id, event);
    remainingParents.set(event.id, event.parentVersion.size);
    for (const parentId of event.parentVersion) {
      const list = childrenIndex.get(parentId) ?? [];
      list.push(event.id);
      childrenIndex.set(parentId, list);
    }
  }

  const ready: EventId[] = [];
  for (const [id, count] of remainingParents) {
    if (count === 0) {
      ready.push(id);
    }
  }

  let added = 0;
  while (ready.length > 0) {
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
    throw new Error(
      `Cannot deserialize event graph with missing parents: ${[
        ...missingParents,
      ].join(", ")}`,
    );
  }

  return graph;
};
