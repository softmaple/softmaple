/**
 * Section 3.2 — Retreat and Advance Stubs
 * Placeholder implementations for CRDT state manipulation
 * Actual implementation deferred to later sections
 */

import type { EventID } from "../types";
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
   */
  retreat(eventId: EventID): void;

  /**
   * Advance the CRDT state by applying an event
   * Called when target version has events not in prepareVersion
   * @param eventId - The event to advance/apply
   */
  advance(eventId: EventID): void;

  /**
   * Apply an event in prepare state
   * This is called when the CRDT is aligned to parent version
   * @param event - The event to apply
   */
  applyPrepare(event: GraphEvent): void;

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
  private appliedEvents = new Set<EventID>();
  private retreatLog: EventID[] = [];
  private advanceLog: EventID[] = [];
  private prepareLog: GraphEvent[] = [];

  retreat(eventId: EventID): void {
    // Stub: just track the retreat for testing
    this.retreatLog.push(eventId);
    this.appliedEvents.delete(eventId);

    // TODO: Actual implementation will undo the event's effects
    // by restoring CRDT to state before event was applied
  }

  advance(eventId: EventID): void {
    // Stub: just track the advance for testing
    this.advanceLog.push(eventId);
    this.appliedEvents.add(eventId);

    // TODO: Actual implementation will apply the event's effects
    // by transforming and applying to current CRDT state
  }

  applyPrepare(event: GraphEvent): void {
    // Stub: just track the prepare application for testing
    this.prepareLog.push(event);
    this.appliedEvents.add(event.id);

    // TODO: Actual implementation will:
    // 1. Transform event indices based on current CRDT state
    // 2. Apply the operation to internal CRDT
    // 3. Update internal CRDT metadata
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
  getRetreatLog(): EventID[] {
    return [...this.retreatLog];
  }

  getAdvanceLog(): EventID[] {
    return [...this.advanceLog];
  }

  getPrepareLog(): GraphEvent[] {
    return [...this.prepareLog];
  }
}
