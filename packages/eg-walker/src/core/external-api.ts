/**
 * External API for Section 3.1 - Index-based operations only
 *
 * This module provides the public interface that:
 * - Only accepts index-based operations
 * - Never exposes CRDT IDs or internal metadata
 * - Returns only plain text state
 */

import { OPERATION_TYPE } from "../constants/operation-types";
import type {
  ExternalOperation,
  DocumentState,
  GraphEvent,
  EventId,
  Version,
  SerializedGraph,
} from "../types";
import { createDocumentState, applyOperation } from "./invariants";
import { EventGraph } from "../graph/event-graph";
import { TemporaryCRDT } from "../crdt/temporary-state";

/**
 * Public API for Eg-walker
 * Strictly index-based, no CRDT exposure
 */
export class EgWalkerAPI {
  private document: string = "";
  private readonly eventGraph: EventGraph;
  private currentVersion: Version = new Set();
  private nextSequenceNumber = 0;

  constructor(
    private readonly replicaId: string,
    initialText: string = "",
  ) {
    this.document = initialText;
    this.eventGraph = new EventGraph();
  }

  /**
   * Insert text at index - public API
   * @param index Position in the document (0-based)
   * @param text Text to insert
   */
  insert(index: number, text: string): void {
    this.validateIndex(index, true);
    if (text.length === 0) {
      return; // No-op for empty insert
    }

    const operation: ExternalOperation = {
      type: OPERATION_TYPE.INSERT,
      index,
      text,
    };

    this.applyLocalOperation(operation);
  }

  /**
   * Delete text at index - public API
   * @param index Starting position (0-based)
   * @param length Number of characters to delete
   */
  delete(index: number, length: number): void {
    this.validateIndex(index, false);
    if (length <= 0) {
      return; // No-op for zero-length delete
    }

    if (index + length > this.document.length) {
      throw new Error(
        `Delete range [${index}, ${index + length}) exceeds document length ${this.document.length}`,
      );
    }

    const operation: ExternalOperation = {
      type: OPERATION_TYPE.DELETE,
      index,
      length,
    };

    this.applyLocalOperation(operation);
  }

  /**
   * Get current document state - public API
   * Returns only plain text, no CRDT metadata
   */
  getDocument(): DocumentState {
    return createDocumentState(this.document);
  }

  /**
   * Get current text content
   */
  getText(): string {
    return this.document;
  }

  /**
   * Serialize the document state (text + event graph)
   */
  serialize(): { text: string; eventGraph: SerializedGraph } {
    return {
      text: this.document,
      eventGraph: this.eventGraph.serialize(),
    };
  }

  /**
   * Deserialize from saved state
   */
  static deserialize(serialized: {
    text: string;
    eventGraph: SerializedGraph;
  }): EgWalkerAPI {
    // Create new instance with the text
    const api = new EgWalkerAPI("deserialized-replica", serialized.text);
    // Restore event graph
    if (serialized.eventGraph) {
      // Note: EventGraph doesn't have deserialize yet, so this is a placeholder
      // api.eventGraph = EventGraph.deserialize(serialized.eventGraph);
    }
    return api;
  }

  /**
   * Apply a local operation and add to event graph
   */
  private applyLocalOperation(operation: ExternalOperation): void {
    // Create event
    const eventId = this.generateEventId();
    const event: GraphEvent = {
      id: eventId,
      operation,
      parentVersion: this.currentVersion,
      timestamp: Date.now(),
    };

    // Apply to local document
    this.document = applyOperation(this.document, operation);

    // Add to event graph
    try {
      this.eventGraph.addEvent(event);
    } catch (error) {
      // Log duplicate event and continue gracefully
      if (error instanceof Error && error.message.includes("already exists")) {
        console.warn(
          `Duplicate event detected in applyLocalOperation: id=${event.id}, source=local, timestamp=${event.timestamp}`,
        );
        return; // Ignore duplicate and continue
      }
      throw error; // Re-throw other errors
    }

    // Update version
    this.currentVersion = new Set([...this.currentVersion, eventId]);
  }

  /**
   * Apply a remote event
   * This will use temporary CRDT for transformation
   */
  async applyRemoteEvent(event: GraphEvent): Promise<void> {
    // Add to event graph
    try {
      this.eventGraph.addEvent(event);
    } catch (error) {
      // Log duplicate event and continue gracefully
      if (error instanceof Error && error.message.includes("already exists")) {
        console.warn(
          `Duplicate event detected in applyRemoteEvent: id=${event.id}, source=remote, timestamp=${event.timestamp}`,
        );
        return; // Ignore duplicate and continue
      }
      throw error; // Re-throw other errors
    }

    // Use temporary CRDT for transformation
    await TemporaryCRDT.withTemporaryCRDT(async (crdt) => {
      // Get all events in topological order
      const sortedEvents = this.eventGraph.getTopologicalOrder();

      // Rebuild document from scratch by replaying all events
      // This ensures deterministic ordering regardless of receipt order
      this.document = "";

      // Process each event with CRDT
      for (const sortedEvent of sortedEvents) {
        // Create CRDT items from event
        const items = crdt.createItemsFromEvent(sortedEvent);
        // Integrate items into CRDT
        crdt.integrate(items);
      }

      // Get the final text from CRDT
      const effectState = crdt.getEffectState();
      this.document = effectState.visibleText;

      // Update current version
      this.currentVersion = new Set(sortedEvents.map((e) => e.id));
    });
  }

  /**
   * Check if event can be applied directly without transformation
   */
  private canApplyDirectly(event: GraphEvent): boolean {
    // Can apply directly if all parent events are in current version
    for (const parentId of event.parentVersion) {
      if (!this.currentVersion.has(parentId)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Validate index for operations
   */
  private validateIndex(index: number, allowEnd: boolean): void {
    const max = allowEnd ? this.document.length : this.document.length - 1;
    if (index < 0 || index > max) {
      throw new Error(
        `Index ${index} out of bounds [0, ${max}] for document of length ${this.document.length}`,
      );
    }
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): EventId {
    return `${this.replicaId}:${this.nextSequenceNumber++}`;
  }

  /**
   * Export event graph for persistence
   * This is what gets saved to disk - no CRDT metadata
   */
  exportEventGraph(): ReadonlyArray<GraphEvent> {
    return this.eventGraph.getAllEvents();
  }

  /**
   * Import event graph from persistence
   */
  static async fromEventGraph(
    replicaId: string,
    events: ReadonlyArray<GraphEvent>,
    initialText: string = "",
  ): Promise<EgWalkerAPI> {
    const api = new EgWalkerAPI(replicaId, initialText);

    // Apply events in causal order
    for (const event of events) {
      await api.applyRemoteEvent(event);
    }

    return api;
  }
}

/**
 * Factory function for creating API instances
 */
export function createEgWalker(
  replicaId: string,
  initialText?: string,
): EgWalkerAPI {
  return new EgWalkerAPI(replicaId, initialText);
}
