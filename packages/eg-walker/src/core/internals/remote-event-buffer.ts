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

  /**
   * Number of remote events currently held back awaiting their causal parents.
   *
   * @returns {number} count of buffered events.
   */
  get pendingCount(): number {
    return this.bufferedEventIds.size;
  }

  /**
   * Apply a remote event, or buffer it until its missing parents arrive.
   *
   * If `event` is already in the graph or already buffered it is ignored.
   * If any parent is unknown the event is queued against the missing parent
   * id; the queue is flushed when that parent is later accepted. Otherwise
   * the event is added to the graph and `deps.advanceWithEvent` is invoked,
   * then any waiters queued on this event's id are recursively accepted.
   *
   * @param {GraphEvent} event remote event to accept or buffer.
   */
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
