import { EgWalkerReplica } from "../core/replica";
import type { GraphEvent } from "../types";

export const cloneEvent = (event: GraphEvent): GraphEvent => ({
  id: event.id,
  operation: { ...event.operation },
  parentVersion: new Set(event.parentVersion),
  timestamp: event.timestamp,
});

export const bootstrapReplica = (
  replicaId: string,
  text: string,
): EgWalkerReplica => {
  const replica = new EgWalkerReplica(replicaId);
  replica.insert(0, text);
  return replica;
};

export const replicaFromEvents = (
  replicaId: string,
  events: ReadonlyArray<GraphEvent>,
): EgWalkerReplica => {
  const replica = new EgWalkerReplica(replicaId);
  for (const event of events) {
    replica.applyRemoteEvent(cloneEvent(event));
  }
  return replica;
};
