import type { EventGraph } from "../../graph/event-graph";

export interface ReplicaPersistenceMetadata {
  readonly initialText?: string;
  readonly nextSequenceNumber?: number;
}

export const readReplicaMetadata = (
  graph: EventGraph,
): ReplicaPersistenceMetadata => {
  const raw = graph.getMetadata();
  const rawInitialText = raw.initialText;
  const rawNextSequenceNumber = raw.nextSequenceNumber;
  return {
    initialText:
      typeof rawInitialText === "string" ? rawInitialText : undefined,
    nextSequenceNumber:
      typeof rawNextSequenceNumber === "number"
        ? rawNextSequenceNumber
        : undefined,
  };
};

export const writeReplicaMetadata = (
  graph: EventGraph,
  metadata: ReplicaPersistenceMetadata,
): void => {
  graph.setMetadata({
    ...graph.getMetadata(),
    ...metadata,
  });
};
