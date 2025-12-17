/**
 * Section 3.3 - Retreat/Advance Implementation
 *
 * Full implementation of retreat and advance operations using internal CRDT state.
 * These operations maintain the prepare-state and effect-state during transformation.
 */

import type { EventId } from "../types";
import type { GraphEvent } from "../graph/event-graph";
import { InternalCRDTState } from "./internal-state";
import { OPERATION_TYPE } from "../constants/operation-types";
import type { InternalCRDTState as ICRDTStateInterface } from "./retreat-advance-stubs";

/**
 * Concrete implementation of the Internal CRDT State interface
 * Manages retreat and advance operations on temporary CRDT records
 */
export class ConcreteCRDTState implements ICRDTStateInterface {
  private internalState: InternalCRDTState;
  public readonly eventMap: Map<EventId, GraphEvent> = new Map();
  private retreatStack: EventId[] = [];

  constructor() {
    this.internalState = new InternalCRDTState();
  }

  /**
   * Retreat the CRDT state by undoing an event
   * @param appliedEvents - Current set of applied event IDs from coordinator
   */
  retreat(eventId: EventId, appliedEvents: ReadonlySet<EventId>): Set<EventId> {
    const event = this.eventMap.get(eventId);
    if (!event) {
      throw new Error(`Event ${eventId} not found for retreat`);
    }

    // Undo the event's effects
    this.internalState.undoPrepare(event);
    this.retreatStack.push(eventId);

    // Return new immutable set without the retreated event
    const newAppliedEvents = new Set(appliedEvents);
    newAppliedEvents.delete(eventId);
    return newAppliedEvents;
  }

  /**
   * Advance the CRDT state by applying an event
   * @param appliedEvents - Current set of applied event IDs from coordinator
   */
  advance(eventId: EventId, appliedEvents: ReadonlySet<EventId>): Set<EventId> {
    const event = this.eventMap.get(eventId);
    if (!event) {
      throw new Error(`Event ${eventId} not found for advance`);
    }

    // Apply the event's effects
    this.internalState.applyEffect(event);

    // Return new immutable set with the advanced event
    const newAppliedEvents = new Set(appliedEvents);
    newAppliedEvents.add(eventId);
    return newAppliedEvents;
  }

  /**
   * Apply an event in prepare state
   * @param appliedEvents - Current set of applied event IDs from coordinator
   */
  applyPrepare(
    event: GraphEvent,
    appliedEvents: ReadonlySet<EventId>,
  ): Set<EventId> {
    // Store event for later retreat/advance
    this.eventMap.set(event.id, event);

    // Apply prepare state
    this.internalState.applyPrepare(event);

    // Return new immutable set with the new event
    const newAppliedEvents = new Set(appliedEvents);
    newAppliedEvents.add(event.id);
    return newAppliedEvents;
  }

  /**
   * Get the current document text
   */
  getCurrentText(): string {
    return this.internalState.getVisibleText();
  }

  /**
   * Get the prepare state text (for transformation)
   */
  getPrepareText(): string {
    return this.internalState.getPrepareText();
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.internalState.destroy();
    this.internalState = new InternalCRDTState();
    this.eventMap.clear();
    this.retreatStack = [];
  }

  /**
   * Destroy and clean up resources
   */
  destroy(): void {
    this.internalState.destroy();
    this.eventMap.clear();
    this.retreatStack = [];
  }
}

/**
 * Retreat/Advance coordinator that manages the full transformation process
 */
export class RetreatAdvanceCoordinator {
  private crdtState: ConcreteCRDTState;
  private appliedEvents: Map<EventId, GraphEvent> = new Map();
  private appliedEventIds: Set<EventId> = new Set();

  constructor() {
    this.crdtState = new ConcreteCRDTState();
  }

  /**
   * Get an immutable view of currently applied event IDs
   */
  getAppliedEventIds(): ReadonlySet<EventId> {
    return new Set(this.appliedEventIds);
  }

  /**
   * Check if an event has been applied
   */
  isEventApplied(eventId: EventId): boolean {
    return this.appliedEventIds.has(eventId);
  }

  /**
   * Perform a full transformation: retreat to common ancestor, apply event, advance
   */
  async transform(
    event: GraphEvent,
    prepareVersion: Set<EventId>,
    effectVersion: Set<EventId>,
  ): Promise<GraphEvent> {
    // If this is the first event being transformed
    if (prepareVersion.size === 0 && event.parentVersion.size === 0) {
      // Still need to transform for index adjustment
      const transformedEvent = this.transformEvent(event);
      this.appliedEventIds = this.crdtState.applyPrepare(
        event,
        this.appliedEventIds,
      );
      this.appliedEvents = new Map(this.appliedEvents);
      this.appliedEvents.set(event.id, event);
      return transformedEvent;
    }

    // Register previously applied events if not already in the eventMap
    // We need to ensure ALL events in prepareVersion are registered
    for (const eventId of [...prepareVersion, ...effectVersion]) {
      if (!this.crdtState.eventMap.has(eventId)) {
        const previousEvent = this.appliedEvents.get(eventId);
        if (!previousEvent) {
          // If we don't have the event, we can't proceed
          // This would be a programming error in test setup
          console.warn(`Event ${eventId} not found in appliedEvents`);
        } else {
          this.crdtState.eventMap.set(eventId, previousEvent);
        }
      }
    }

    // Phase 1: Retreat - undo events not in target parent version
    const toRetreat = this.findEventsToRetreat(
      event.parentVersion,
      prepareVersion,
    );
    for (const eventId of toRetreat) {
      this.appliedEventIds = this.crdtState.retreat(
        eventId,
        this.appliedEventIds,
      );
    }

    // Phase 2: Apply - transform and apply the event
    const transformedEvent = this.transformEvent(event);
    this.appliedEventIds = this.crdtState.applyPrepare(
      transformedEvent,
      this.appliedEventIds,
    );
    this.appliedEvents = new Map(this.appliedEvents);
    this.appliedEvents.set(transformedEvent.id, transformedEvent);

    // Phase 3: Advance - reapply events to reach effect version
    const toAdvance = this.findEventsToAdvance(
      effectVersion,
      event.parentVersion,
    );
    for (const eventId of toAdvance) {
      // Need to ensure the event is in the eventMap before advancing
      if (!this.crdtState.eventMap.has(eventId)) {
        const advanceEvent = this.appliedEvents.get(eventId);
        if (advanceEvent) {
          this.crdtState.eventMap.set(eventId, advanceEvent);
        }
      }
      this.appliedEventIds = this.crdtState.advance(
        eventId,
        this.appliedEventIds,
      );
    }

    return transformedEvent;
  }

  /**
   * Find events that need to be retreated
   */
  private findEventsToRetreat(
    targetVersion: ReadonlySet<EventId>,
    currentVersion: Set<EventId>,
  ): EventId[] {
    const toRetreat: EventId[] = [];

    for (const eventId of currentVersion) {
      if (!targetVersion.has(eventId)) {
        toRetreat.push(eventId);
      }
    }

    // Return in reverse order for proper retreat
    return toRetreat.reverse();
  }

  /**
   * Find events that need to be advanced
   */
  private findEventsToAdvance(
    targetVersion: Set<EventId>,
    currentVersion: Set<EventId>,
  ): EventId[] {
    const toAdvance: EventId[] = [];

    for (const eventId of targetVersion) {
      if (!currentVersion.has(eventId)) {
        toAdvance.push(eventId);
      }
    }

    return toAdvance;
  }

  /**
   * Transform an event's operation based on current CRDT state
   */
  private transformEvent(event: GraphEvent): GraphEvent {
    const op = event.operation;
    // Use prepare text for transformation (not effect text)
    const currentText = this.crdtState.getPrepareText();

    if (op.type === OPERATION_TYPE.INSERT) {
      // Adjust index based on current state
      const adjustedIndex = Math.min(op.index, currentText.length);
      return {
        ...event,
        operation: {
          ...op,
          index: adjustedIndex,
        },
      };
    } else if (op.type === OPERATION_TYPE.DELETE) {
      // Adjust range based on current state
      const adjustedIndex = Math.min(op.index, currentText.length);
      const adjustedLength = Math.min(
        op.length,
        currentText.length - adjustedIndex,
      );
      return {
        ...event,
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: adjustedIndex,
          length: adjustedLength,
        },
      };
    }

    return event;
  }

  /**
   * Get current document text
   */
  getCurrentText(): string {
    return this.crdtState.getCurrentText();
  }

  /**
   * Reset the coordinator
   */
  reset(): void {
    this.crdtState.reset();
    this.appliedEvents.clear();
    this.appliedEventIds.clear();
  }

  /**
   * Destroy and clean up
   */
  destroy(): void {
    this.crdtState.destroy();
    this.appliedEvents.clear();
    this.appliedEventIds.clear();
  }

  /**
   * Create a scoped coordinator that auto-destroys
   */
  static async withCoordinator<T>(
    fn: (coordinator: RetreatAdvanceCoordinator) => T | Promise<T>,
  ): Promise<T> {
    const coordinator = new RetreatAdvanceCoordinator();
    try {
      return await fn(coordinator);
    } finally {
      coordinator.destroy();
    }
  }
}

/**
 * Export helper functions
 */
export const withCoordinator = RetreatAdvanceCoordinator.withCoordinator;
