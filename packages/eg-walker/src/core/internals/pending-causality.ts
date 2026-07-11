import type { EventId, GraphEvent } from "../../types";

const VISITING = 1;
const VISITED = 2;

interface TraversalFrame {
  readonly event: GraphEvent;
  readonly parents: ReadonlyArray<EventId>;
  nextParentIndex: number;
}

/**
 * Reject a cycle introduced by new remote candidates without scanning the
 * entire pending set. The existing buffered subgraph is already acyclic, so
 * every newly-created cycle must be reachable from at least one candidate.
 *
 * Returns the number of candidate/buffered events visited for structural
 * performance assertions.
 */
export const assertPendingCandidatesAcyclic = (
  candidates: ReadonlyArray<GraphEvent>,
  getBufferedEvent: (eventId: EventId) => GraphEvent | undefined,
): number => {
  const candidatesById = new Map(
    candidates.map((event) => [event.id, event] as const),
  );
  const colors = new Map<EventId, typeof VISITING | typeof VISITED>();
  let visitedEvents = 0;

  const resolvePendingEvent = (eventId: EventId): GraphEvent | undefined =>
    candidatesById.get(eventId) ?? getBufferedEvent(eventId);

  for (const candidate of candidates) {
    if (colors.get(candidate.id) === VISITED) {
      continue;
    }

    colors.set(candidate.id, VISITING);
    visitedEvents++;
    const stack: TraversalFrame[] = [createFrame(candidate)];
    while (stack.length > 0) {
      const frame = stack.at(-1)!;
      const parentId = frame.parents[frame.nextParentIndex++];
      if (parentId === undefined) {
        colors.set(frame.event.id, VISITED);
        stack.pop();
        continue;
      }

      const parent = resolvePendingEvent(parentId);
      if (parent === undefined) {
        continue;
      }
      const parentColor = colors.get(parent.id);
      if (parentColor === VISITING) {
        throw new Error("remote event batch contains a causal cycle");
      }
      if (parentColor === VISITED) {
        continue;
      }

      colors.set(parent.id, VISITING);
      visitedEvents++;
      stack.push(createFrame(parent));
    }
  }

  return visitedEvents;
};

const createFrame = (event: GraphEvent): TraversalFrame => ({
  event,
  parents: Array.from(event.parentVersion),
  nextParentIndex: 0,
});
