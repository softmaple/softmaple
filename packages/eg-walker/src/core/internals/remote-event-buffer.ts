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

export interface RemoteEventBufferTransaction {
  readonly touchedEntryCount: number;
  commit(): void;
  rollback(): void;
}

interface RemoteEventBufferTransactionState {
  readonly pendingBefore: Map<EventId, PendingQueueBefore>;
  readonly bufferedBefore: Map<EventId, GraphEvent | undefined>;
}

interface PendingQueueBefore {
  readonly queue: GraphEvent[] | undefined;
  readonly length: number;
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
  private activeTransaction: RemoteEventBufferTransactionState | null = null;

  constructor(private readonly deps: RemoteEventBufferDeps) {}

  get pendingCount(): number {
    return this.bufferedEventsById.size;
  }

  getBufferedEvent(eventId: EventId): GraphEvent | undefined {
    return this.bufferedEventsById.get(eventId);
  }

  beginTransaction(): RemoteEventBufferTransaction {
    if (this.activeTransaction !== null) {
      throw new Error("Remote event buffer transaction is already active");
    }
    const state: RemoteEventBufferTransactionState = {
      pendingBefore: new Map(),
      bufferedBefore: new Map(),
    };
    this.activeTransaction = state;
    let active = true;
    const finish = (): boolean => {
      if (!active) return false;
      active = false;
      if (this.activeTransaction !== state) {
        throw new Error("Remote event buffer transaction state changed");
      }
      this.activeTransaction = null;
      return true;
    };
    return {
      get touchedEntryCount(): number {
        return state.pendingBefore.size + state.bufferedBefore.size;
      },
      commit: (): void => {
        finish();
      },
      rollback: (): void => {
        if (!finish()) return;
        restorePendingQueues(this.pendingByMissingParent, state.pendingBefore);
        restoreMapEntries(this.bufferedEventsById, state.bufferedBefore);
      },
    };
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
      this.recordBufferedBefore(waiter.id);
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
    const queue = this.pendingByMissingParent.get(missingParent);
    this.recordPendingBefore(missingParent);
    if (queue === undefined) {
      this.pendingByMissingParent.set(missingParent, [event]);
    } else {
      queue.push(event);
    }
    this.recordBufferedBefore(event.id);
    this.bufferedEventsById.set(event.id, event);
  }

  private takePendingChildrenOf(parentId: EventId): GraphEvent[] {
    const waiters = this.pendingByMissingParent.get(parentId) ?? [];
    this.recordPendingBefore(parentId);
    this.pendingByMissingParent.delete(parentId);
    return waiters;
  }

  private recordPendingBefore(parentId: EventId): void {
    const journal = this.activeTransaction?.pendingBefore;
    if (journal !== undefined && !journal.has(parentId)) {
      const queue = this.pendingByMissingParent.get(parentId);
      journal.set(parentId, { queue, length: queue?.length ?? 0 });
    }
  }

  private recordBufferedBefore(eventId: EventId): void {
    const journal = this.activeTransaction?.bufferedBefore;
    if (journal !== undefined && !journal.has(eventId)) {
      journal.set(eventId, this.bufferedEventsById.get(eventId));
    }
  }
}

const pushReversed = <T>(target: T[], values: ReadonlyArray<T>): void => {
  for (let index = values.length - 1; index >= 0; index--) {
    target.push(values[index]!);
  }
};

const restoreMapEntries = <K, V>(
  target: Map<K, V>,
  entries: ReadonlyMap<K, V | undefined>,
): void => {
  for (const [key, value] of entries) {
    if (value === undefined) {
      target.delete(key);
    } else {
      target.set(key, value);
    }
  }
};

const restorePendingQueues = (
  target: Map<EventId, GraphEvent[]>,
  entries: ReadonlyMap<EventId, PendingQueueBefore>,
): void => {
  for (const [key, before] of entries) {
    if (before.queue === undefined) {
      target.delete(key);
    } else {
      before.queue.length = before.length;
      target.set(key, before.queue);
    }
  }
};
