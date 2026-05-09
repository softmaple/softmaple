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
  SerializedGraphInput,
  SerializedGraphOutput,
} from "../types";
import { createDocumentState } from "./invariants";
import {
  EventGraph,
  EventAlreadyExistsError,
  MissingParentError,
} from "../graph/event-graph";
import { EgWalkerEngine } from "../engine/eg-walker-engine";

/**
 * Public API for Eg-walker
 * Strictly index-based, no CRDT exposure
 */
export class EgWalkerAPI {
  private document: string = "";
  private readonly initialText: string;
  private readonly eventGraph: EventGraph;
  private currentVersion: Version = new Set();
  private nextSequenceNumber = 0;
  private engine: EgWalkerEngine | null = null;
  private readonly pendingByMissingParent = new Map<EventId, GraphEvent[]>();
  private readonly bufferedEventIds = new Set<EventId>();

  constructor(
    private readonly replicaId: string,
    initialText: string = "",
    eventGraph?: EventGraph,
  ) {
    this.document = initialText;
    this.initialText = initialText;
    this.eventGraph = eventGraph ?? new EventGraph();
    this.currentVersion = this.eventGraph.getFrontier();
    this.nextSequenceNumber = this.inferNextSequenceNumber();
    if (this.eventGraph.getAllEvents().length > 0) {
      this.fullReplay();
    }
  }

  /**
   * Insert text at index - public API
   *
   * Validation lives in {@link applyLocalOperation} so direct callers and
   * `insert`/`delete` get the same guarantees without duplicating checks.
   */
  insert(index: number, text: string): void {
    this.applyLocalOperation({
      type: OPERATION_TYPE.INSERT,
      index,
      text,
    });
  }

  /**
   * Delete text at index - public API
   */
  delete(index: number, length: number): void {
    this.applyLocalOperation({
      type: OPERATION_TYPE.DELETE,
      index,
      length,
    });
  }

  /**
   * Get current document state - public API
   * Returns only plain text, no CRDT metadata
   */
  getDocument(): DocumentState {
    return createDocumentState(this.document);
  }

  getText(): string {
    return this.document;
  }

  /**
   * Serialize the document state (text + event graph)
   */
  serialize(): { text: string; eventGraph: SerializedGraphOutput } {
    this.eventGraph.setMetadata({
      ...this.eventGraph.getMetadata(),
      initialText: this.initialText,
      nextSequenceNumber: this.nextSequenceNumber,
    });

    return {
      text: this.document,
      eventGraph: this.eventGraph.serialize(),
    };
  }

  static deserialize(
    serialized: {
      text: string;
      eventGraph: SerializedGraphInput | null;
    },
    replicaId: string = "deserialized-replica",
  ): EgWalkerAPI {
    if (!serialized.eventGraph) {
      return new EgWalkerAPI(replicaId, serialized.text);
    }

    const graph = EventGraph.deserialize(serialized.eventGraph);
    const metadata = graph.getMetadata();
    const initialText =
      typeof metadata.initialText === "string"
        ? metadata.initialText
        : graph.getAllEvents().length === 0
          ? serialized.text
          : "";
    const api = new EgWalkerAPI(replicaId, initialText, graph);

    if (typeof metadata.nextSequenceNumber === "number") {
      api.nextSequenceNumber = metadata.nextSequenceNumber;
    }

    return api;
  }

  /**
   * Apply a local operation and add to event graph.
   *
   * Local operations are always causally rooted at {@link currentVersion}, so
   * the engine can advance incrementally rather than replay from scratch.
   */
  applyLocalOperation(operation: ExternalOperation): void {
    const validatedOperation = this.validateLocalOperation(operation);
    if (!validatedOperation) {
      return;
    }

    const event: GraphEvent = {
      id: this.generateEventId(),
      operation: validatedOperation,
      parentVersion: this.currentVersion,
      timestamp: Date.now(),
    };

    try {
      this.eventGraph.addEvent(event);
    } catch (error) {
      if (error instanceof EventAlreadyExistsError) {
        return;
      }
      throw error;
    }

    this.advanceWithEvent(event);
  }

  /**
   * Apply a remote event. Buffers events with unknown parents until they can
   * be applied in causal order, so callers do not need to deliver in order.
   */
  applyRemoteEvent(event: GraphEvent): void {
    this.tryAcceptRemoteEvent(event);
  }

  /**
   * Number of remote events currently buffered awaiting causal parents.
   * Exposed primarily for tests and diagnostics.
   */
  getPendingRemoteCount(): number {
    return this.bufferedEventIds.size;
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): EventId {
    return `${this.replicaId}:${this.nextSequenceNumber++}`;
  }

  private validateIndex(index: number, allowEnd: boolean): void {
    const max = allowEnd ? this.document.length : this.document.length - 1;
    if (index < 0 || index > max) {
      throw new Error(
        `Index ${index} out of bounds [0, ${max}] for document of length ${this.document.length}`,
      );
    }
  }

  private validateLocalOperation(
    operation: ExternalOperation,
  ): ExternalOperation | null {
    if (operation.type === OPERATION_TYPE.INSERT) {
      this.validateIndex(operation.index, true);
      if (operation.text.length === 0) {
        return null;
      }
      return operation;
    }

    this.validateIndex(operation.index, false);
    if (operation.length <= 0) {
      return null;
    }

    if (operation.index + operation.length > this.document.length) {
      throw new Error(
        `Delete range [${operation.index}, ${operation.index + operation.length}) exceeds document length ${this.document.length}`,
      );
    }

    return operation;
  }

  /**
   * Get current document text using the README-compatible API name.
   */
  getDocumentState(): string {
    return this.document;
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
  static fromEventGraph(
    replicaId: string,
    events: ReadonlyArray<GraphEvent>,
    initialText: string = "",
  ): EgWalkerAPI {
    const api = new EgWalkerAPI(replicaId, initialText);

    for (const event of events) {
      api.applyRemoteEvent(event);
    }

    return api;
  }

  private fullReplay(): void {
    const sortedEvents = this.eventGraph.getTopologicalOrder();
    const engine = new EgWalkerEngine();
    const generated = engine.generate(sortedEvents, this.initialText, {
      eventGraph: this.eventGraph,
    });
    this.document = generated.text;
    this.currentVersion = this.eventGraph.getFrontier();
    this.engine = engine;
  }

  private advanceWithEvent(event: GraphEvent): void {
    if (!this.engine || !this.parentsMatchCurrent(event.parentVersion)) {
      // Remote/concurrent events would be processed in arrival order on the
      // incremental path, which diverges from the deterministic topological
      // order each replica needs to converge. Replay from scratch instead.
      this.fullReplay();
      return;
    }

    this.engine.applyEvent(event, this.eventGraph);
    this.document = this.engine.getText();
    this.currentVersion = this.eventGraph.getFrontier();
  }

  private parentsMatchCurrent(parents: ReadonlySet<EventId>): boolean {
    if (parents.size !== this.currentVersion.size) {
      return false;
    }
    for (const id of parents) {
      if (!this.currentVersion.has(id)) {
        return false;
      }
    }
    return true;
  }

  private tryAcceptRemoteEvent(event: GraphEvent): void {
    if (
      this.eventGraph.hasEvent(event.id) ||
      this.bufferedEventIds.has(event.id)
    ) {
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
      this.eventGraph.addEvent(event);
    } catch (error) {
      if (
        error instanceof EventAlreadyExistsError ||
        error instanceof MissingParentError
      ) {
        return;
      }
      throw error;
    }

    this.advanceWithEvent(event);
    this.flushPendingChildrenOf(event.id);
  }

  private findMissingParent(event: GraphEvent): EventId | null {
    for (const parentId of event.parentVersion) {
      if (!this.eventGraph.hasEvent(parentId)) {
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
      this.tryAcceptRemoteEvent(waiter);
    }
  }

  private inferNextSequenceNumber(): number {
    let maxSequenceNumber = -1;
    const prefix = `${this.replicaId}:`;

    for (const event of this.eventGraph.getAllEvents()) {
      if (!event.id.startsWith(prefix)) {
        continue;
      }

      const sequenceNumber = Number(event.id.slice(prefix.length));
      if (Number.isInteger(sequenceNumber)) {
        maxSequenceNumber = Math.max(maxSequenceNumber, sequenceNumber);
      }
    }

    return maxSequenceNumber + 1;
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
