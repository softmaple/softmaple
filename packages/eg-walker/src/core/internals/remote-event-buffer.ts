import {
  EventAlreadyExistsError,
  MissingParentError,
  type EventGraph,
} from "../../graph/event-graph";
import type { EventId, GraphEvent } from "../../types";

interface RemoteEventBufferDeps {
  readonly graph: EventGraph;
  readonly advanceWithEvent: (event: GraphEvent) => void;
}

export class RemoteEventBuffer {
  private readonly pendingByMissingParent = new Map<EventId, GraphEvent[]>();
  private readonly bufferedEventIds = new Set<EventId>();

  constructor(private readonly deps: RemoteEventBufferDeps) {}

  get pendingCount(): number {
    return this.bufferedEventIds.size;
  }

  tryAccept(event: GraphEvent): void {
    const { graph } = this.deps;
    if (graph.hasEvent(event.id) || this.bufferedEventIds.has(event.id)) {
      return;
    }

    const missingParent = this.findMissingParent(event);
    if (missingParent !== null) {
      const queue = this.pendingByMissingParent.get(missingParent) ?? [];
      queue.push(event);
      this.pendingByMissingParent.set(missingParent, queue);
      this.bufferedEventIds.add(event.id);
      return;
    }

    try {
      graph.addEvent(event);
    } catch (error) {
      if (
        error instanceof EventAlreadyExistsError ||
        error instanceof MissingParentError
      ) {
        return;
      }
      throw error;
    }

    this.deps.advanceWithEvent(event);
    this.flushPendingChildrenOf(event.id);
  }

  private findMissingParent(event: GraphEvent): EventId | null {
    for (const parentId of event.parentVersion) {
      if (!this.deps.graph.hasEvent(parentId)) {
        return parentId;
      }
    }
    return null;
  }

  private flushPendingChildrenOf(parentId: EventId): void {
    const waiters = this.pendingByMissingParent.get(parentId);
    if (!waiters) {
      return;
    }
    this.pendingByMissingParent.delete(parentId);
    for (const waiter of waiters) {
      this.bufferedEventIds.delete(waiter.id);
      this.tryAccept(waiter);
    }
  }
}
