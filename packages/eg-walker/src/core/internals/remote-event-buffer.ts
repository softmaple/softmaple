import {
  EventAlreadyExistsError,
  MissingParentError,
  type EventGraph,
} from "../../graph/event-graph";
import {
  APPLY_REMOTE_EVENT_STATUS,
  type ApplyRemoteEventResult,
  type EventId,
  type GraphEvent,
  type PositionOperation,
} from "../../types";

interface RemoteEventBufferDeps {
  readonly graph: EventGraph;
  /**
   * Apply the event on top of existing replica state. The dependency
   * returns the position operation produced by the integration when the
   * engine can attribute one to this event in isolation (incremental
   * advance, single transformed op); otherwise `null` (partial/full
   * replay, multi-op coalesced delete, visible no-op).
   *
   * See `IntegratedApplyRemoteEventResult.operation` for the contract.
   */
  readonly advanceWithEvent: (event: GraphEvent) => PositionOperation | null;
}

const BUFFERED_RESULT = {
  status: APPLY_REMOTE_EVENT_STATUS.Buffered,
} as const;

const DUPLICATE_RESULT = {
  status: APPLY_REMOTE_EVENT_STATUS.Duplicate,
} as const;

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
   * If `event` is already in the graph or already buffered the call is a
   * no-op and reports `"duplicate"`. If any parent is unknown the event
   * is queued against the missing parent id and reports `"buffered"`;
   * the queue is flushed when that parent is later accepted. Otherwise
   * the event is added to the graph, `deps.advanceWithEvent` is invoked,
   * any waiters queued on this event's id are recursively accepted as a
   * side effect (not reported), and the call reports `"integrated"` with
   * the engine-attributed position operation (or `null`; see the type
   * docstring for when).
   *
   * @param {GraphEvent} event remote event to accept or buffer.
   * @returns {ApplyRemoteEventResult} structural integration status.
   */
  tryAccept(event: GraphEvent): ApplyRemoteEventResult {
    const { graph } = this.deps;
    if (graph.hasEvent(event.id) || this.bufferedEventIds.has(event.id)) {
      return DUPLICATE_RESULT;
    }

    const missingParent = this.findMissingParent(event);
    if (missingParent !== null) {
      const queue = this.pendingByMissingParent.get(missingParent) ?? [];
      queue.push(event);
      this.pendingByMissingParent.set(missingParent, queue);
      this.bufferedEventIds.add(event.id);
      return BUFFERED_RESULT;
    }

    try {
      graph.addEvent(event);
    } catch (error) {
      if (
        error instanceof EventAlreadyExistsError ||
        error instanceof MissingParentError
      ) {
        return DUPLICATE_RESULT;
      }
      throw error;
    }

    const operation = this.deps.advanceWithEvent(event);
    this.flushPendingChildrenOf(event.id);
    return {
      status: APPLY_REMOTE_EVENT_STATUS.Integrated,
      operation,
    };
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
