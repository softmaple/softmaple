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
  private eventMap: Map<EventId, GraphEvent> = new Map();
  private appliedEvents = new Set<EventId>();
  private retreatStack: EventId[] = [];

  constructor() {
    this.internalState = new InternalCRDTState();
  }

  /**
   * Retreat the CRDT state by undoing an event
   */
  retreat(eventId: EventId): void {
    const event = this.eventMap.get(eventId);
    if (!event) {
      throw new Error(`Event ${eventId} not found for retreat`);
    }

    // Undo the event's effects
    this.internalState.undoPrepare(event);
    this.appliedEvents.delete(eventId);
    this.retreatStack.push(eventId);
  }

  /**
   * Advance the CRDT state by applying an event
   */
  advance(eventId: EventId): void {
    const event = this.eventMap.get(eventId);
    if (!event) {
      throw new Error(`Event ${eventId} not found for advance`);
    }

    // Apply the event's effects
    this.internalState.applyEffect(event);
    this.appliedEvents.add(eventId);
  }

  /**
   * Apply an event in prepare state
   */
  applyPrepare(event: GraphEvent): void {
    // Store event for later retreat/advance
    this.eventMap.set(event.id, event);

    // Apply prepare state
    this.internalState.applyPrepare(event);
    this.appliedEvents.add(event.id);
  }

  /**
   * Get the current document text
   */
  getCurrentText(): string {
    return this.internalState.getVisibleText();
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.internalState.destroy();
    this.internalState = new InternalCRDTState();
    this.eventMap.clear();
    this.appliedEvents.clear();
    this.retreatStack = [];
  }

  /**
   * Destroy and clean up resources
   */
  destroy(): void {
    this.internalState.destroy();
    this.eventMap.clear();
    this.appliedEvents.clear();
    this.retreatStack = [];
  }
}

/**
 * Retreat/Advance coordinator that manages the full transformation process
 */
export class RetreatAdvanceCoordinator {
  private crdtState: ConcreteCRDTState;

  constructor() {
    this.crdtState = new ConcreteCRDTState();
  }

  /**
   * Perform a full transformation: retreat to common ancestor, apply event, advance
   */
  async transform(
    event: GraphEvent,
    prepareVersion: Set<EventId>,
    effectVersion: Set<EventId>,
  ): Promise<GraphEvent> {
    // Phase 1: Retreat - undo events not in target parent version
    const toRetreat = this.findEventsToRetreat(
      event.parentVersion,
      prepareVersion,
    );
    for (const eventId of toRetreat) {
      this.crdtState.retreat(eventId);
    }

    // Phase 2: Apply - transform and apply the event
    const transformedEvent = this.transformEvent(event);
    this.crdtState.applyPrepare(transformedEvent);

    // Phase 3: Advance - reapply events to reach effect version
    const toAdvance = this.findEventsToAdvance(effectVersion, prepareVersion);
    for (const eventId of toAdvance) {
      this.crdtState.advance(eventId);
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
    const currentText = this.crdtState.getCurrentText();

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
  }

  /**
   * Destroy and clean up
   */
  destroy(): void {
    this.crdtState.destroy();
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
