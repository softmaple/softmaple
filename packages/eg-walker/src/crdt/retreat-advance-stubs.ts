/**
 * Section 3.2 — Retreat and Advance Stubs
 * Placeholder implementations for CRDT state manipulation
 * Actual implementation deferred to later sections
 */

import type { EventId } from "../types";
import type { GraphEvent } from "../graph/event-graph";

/**
 * Internal CRDT state manager (stub)
 * This interface defines what the walker expects from the internal CRDT
 */
export interface InternalCRDTState {
  /**
   * Retreat the CRDT state by undoing an event
   * Called when prepareVersion has events not in target parent version
   * @param eventId - The event to retreat/undo
   * @param appliedEvents - Current set of applied event IDs
   * @returns New set of applied event IDs after retreat
   */
  retreat(eventId: EventId, appliedEvents: ReadonlySet<EventId>): Set<EventId>;

  /**
   * Advance the CRDT state by applying an event
   * Called when target version has events not in prepareVersion
   * @param eventId - The event to advance/apply
   * @param appliedEvents - Current set of applied event IDs
   * @returns New set of applied event IDs after advance
   */
  advance(eventId: EventId, appliedEvents: ReadonlySet<EventId>): Set<EventId>;

  /**
   * Apply an event in prepare state
   * This is called when the CRDT is aligned to parent version
   * @param event - The event to apply
   * @param appliedEvents - Current set of applied event IDs
   * @returns New set of applied event IDs after apply
   */
  applyPrepare(
    event: GraphEvent,
    appliedEvents: ReadonlySet<EventId>,
  ): Set<EventId>;

  /**
   * Get the current state as a string (for debugging/testing)
   */
  getCurrentText(): string;

  /**
   * Reset the CRDT to initial state
   */
  reset(): void;
}

/**
 * Stub implementation of internal CRDT state
 * To be replaced with actual CRDT implementation in later sections
 */
export class StubInternalCRDT implements InternalCRDTState {
  private appliedEvents = new Set<EventId>();
  private retreatLog: EventId[] = [];
  private advanceLog: EventId[] = [];
  private prepareLog: GraphEvent[] = [];

  retreat(eventId: EventId, appliedEvents: ReadonlySet<EventId>): Set<EventId> {
    // Stub: just track the retreat for testing
    this.retreatLog.push(eventId);
    this.appliedEvents.delete(eventId);

    // TODO: Actual implementation will undo the event's effects
    // by restoring CRDT to state before event was applied
    const newAppliedEvents = new Set(appliedEvents);
    newAppliedEvents.delete(eventId);
    return newAppliedEvents;
  }

  advance(eventId: EventId, appliedEvents: ReadonlySet<EventId>): Set<EventId> {
    // Stub: just track the advance for testing
    this.advanceLog.push(eventId);
    this.appliedEvents.add(eventId);

    // TODO: Actual implementation will apply the event's effects
    // by transforming and applying to current CRDT state
    const newAppliedEvents = new Set(appliedEvents);
    newAppliedEvents.add(eventId);
    return newAppliedEvents;
  }

  applyPrepare(
    event: GraphEvent,
    appliedEvents: ReadonlySet<EventId>,
  ): Set<EventId> {
    // Stub: just track the prepare application for testing
    this.prepareLog.push(event);
    this.appliedEvents.add(event.id);

    // TODO: Actual implementation will:
    // 1. Transform event indices based on current CRDT state
    // 2. Apply the operation to internal CRDT
    // 3. Update internal CRDT metadata
    const newAppliedEvents = new Set(appliedEvents);
    newAppliedEvents.add(event.id);
    return newAppliedEvents;
  }

  getCurrentText(): string {
    // Stub: return a simple representation
    return `[STUB: ${this.appliedEvents.size} events applied]`;
  }

  reset(): void {
    this.appliedEvents.clear();
    this.retreatLog = [];
    this.advanceLog = [];
    this.prepareLog = [];
  }

  // Test helpers to verify correct call order
  getRetreatLog(): EventId[] {
    return [...this.retreatLog];
  }

  getAdvanceLog(): EventId[] {
    return [...this.advanceLog];
  }

  getPrepareLog(): GraphEvent[] {
    return [...this.prepareLog];
  }
}
