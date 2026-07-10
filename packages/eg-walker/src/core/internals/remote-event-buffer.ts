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

export interface RemoteIntegrationEffect {
  readonly operation: PositionOperation | null;
  readonly exact: boolean;
}

export interface RemoteIntegration {
  readonly eventId: EventId;
  readonly effect: RemoteIntegrationEffect;
}

export interface RemoteAcceptance {
  readonly directResult: ApplyRemoteEventResult;
  readonly integrations: ReadonlyArray<RemoteIntegration>;
}

export interface RemoteEventBufferSnapshot {
  readonly pending: ReadonlyArray<
    readonly [missingParent: EventId, events: ReadonlyArray<GraphEvent>]
  >;
}

interface RemoteEventBufferDeps {
  readonly graph: EventGraph;
  readonly advanceWithEvent: (event: GraphEvent) => RemoteIntegrationEffect;
}

const BUFFERED_RESULT = {
  status: APPLY_REMOTE_EVENT_STATUS.Buffered,
} as const;

const DUPLICATE_RESULT = {
  status: APPLY_REMOTE_EVENT_STATUS.Duplicate,
} as const;

export class RemoteEventBuffer {
  private readonly pendingByMissingParent = new Map<EventId, GraphEvent[]>();
  private readonly bufferedEventsById = new Map<EventId, GraphEvent>();

  constructor(private readonly deps: RemoteEventBufferDeps) {}

  get pendingCount(): number {
    return this.bufferedEventsById.size;
  }

  getBufferedEvent(eventId: EventId): GraphEvent | undefined {
    return this.bufferedEventsById.get(eventId);
  }

  getBufferedEvents(): ReadonlyArray<GraphEvent> {
    return Array.from(this.bufferedEventsById.values());
  }

  snapshot(): RemoteEventBufferSnapshot {
    return {
      pending: Array.from(this.pendingByMissingParent, ([parent, events]) => [
        parent,
        [...events],
      ]),
    };
  }

  restore(snapshot: RemoteEventBufferSnapshot): void {
    this.pendingByMissingParent.clear();
    this.bufferedEventsById.clear();
    for (const [parent, events] of snapshot.pending) {
      const restored = [...events];
      this.pendingByMissingParent.set(parent, restored);
      for (const event of restored) {
        this.bufferedEventsById.set(event.id, event);
      }
    }
  }

  tryAccept(event: GraphEvent): ApplyRemoteEventResult {
    return this.tryAcceptDetailed(event).directResult;
  }

  /**
   * Accept one ready-or-buffered event and report every integration caused by
   * draining its pending descendants. The drain is iterative so adversarial
   * reverse-order chains cannot exhaust the JavaScript stack.
   */
  tryAcceptDetailed(event: GraphEvent): RemoteAcceptance {
    if (
      this.deps.graph.hasEvent(event.id) ||
      this.bufferedEventsById.has(event.id)
    ) {
      return { directResult: DUPLICATE_RESULT, integrations: [] };
    }

    const missingParent = this.findMissingParent(event);
    if (missingParent !== null) {
      this.bufferAgainst(event, missingParent);
      return { directResult: BUFFERED_RESULT, integrations: [] };
    }

    const effect = this.integrateReadyEvent(event);
    if (effect === null) {
      return { directResult: DUPLICATE_RESULT, integrations: [] };
    }
    const descendants = this.flushPendingChildrenOf(event.id);
    return {
      directResult: {
        status: APPLY_REMOTE_EVENT_STATUS.Integrated,
        operation: descendants.length === 0 ? effect.operation : null,
      },
      integrations: [{ eventId: event.id, effect }, ...descendants],
    };
  }

  private integrateReadyEvent(
    event: GraphEvent,
  ): RemoteIntegrationEffect | null {
    try {
      this.deps.graph.addEvent(event);
    } catch (error) {
      if (
        error instanceof EventAlreadyExistsError ||
        error instanceof MissingParentError
      ) {
        return null;
      }
      throw error;
    }
    return this.deps.advanceWithEvent(event);
  }

  private findMissingParent(event: GraphEvent): EventId | null {
    for (const parentId of event.parentVersion) {
      if (!this.deps.graph.hasEvent(parentId)) {
        return parentId;
      }
    }
    return null;
  }

  private flushPendingChildrenOf(parentId: EventId): RemoteIntegration[] {
    const stack: GraphEvent[] = [];
    pushReversed(stack, this.takePendingChildrenOf(parentId));
    const integrations: RemoteIntegration[] = [];

    while (stack.length > 0) {
      const waiter = stack.pop()!;
      this.bufferedEventsById.delete(waiter.id);

      if (this.deps.graph.hasEvent(waiter.id)) {
        continue;
      }
      const missingParent = this.findMissingParent(waiter);
      if (missingParent !== null) {
        this.bufferAgainst(waiter, missingParent);
        continue;
      }

      const effect = this.integrateReadyEvent(waiter);
      if (effect === null) {
        continue;
      }
      integrations.push({ eventId: waiter.id, effect });
      pushReversed(stack, this.takePendingChildrenOf(waiter.id));
    }

    return integrations;
  }

  private bufferAgainst(event: GraphEvent, missingParent: EventId): void {
    const queue = this.pendingByMissingParent.get(missingParent) ?? [];
    queue.push(event);
    this.pendingByMissingParent.set(missingParent, queue);
    this.bufferedEventsById.set(event.id, event);
  }

  private takePendingChildrenOf(parentId: EventId): GraphEvent[] {
    const waiters = this.pendingByMissingParent.get(parentId) ?? [];
    this.pendingByMissingParent.delete(parentId);
    return waiters;
  }
}

const pushReversed = <T>(target: T[], values: ReadonlyArray<T>): void => {
  for (let index = values.length - 1; index >= 0; index--) {
    target.push(values[index]!);
  }
};
