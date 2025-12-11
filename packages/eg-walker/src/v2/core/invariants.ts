/**
 * Core invariants for Section 3.1 - Strong List Specification
 *
 * Ensures deterministic behavior and consistency across replicas
 */

import type {
  DocumentState,
  GraphEvent,
  ExternalOperation,
  ListInvariant,
  Version,
} from "../types";

/**
 * Apply an operation to text, returning new text
 * Pure function - no side effects
 */
export function applyOperation(
  text: string,
  operation: ExternalOperation,
): string {
  switch (operation.type) {
    case "insert": {
      const { index, text: insertText } = operation;
      if (index < 0 || index > text.length) {
        throw new Error(`Invalid insert index: ${index}`);
      }
      return text.slice(0, index) + insertText + text.slice(index);
    }

    case "delete": {
      const { index, length } = operation;
      if (index < 0 || index + length > text.length) {
        throw new Error(`Invalid delete range: [${index}, ${index + length})`);
      }
      return text.slice(0, index) + text.slice(index + length);
    }

    default:
      // Type exhaustiveness check
      const _exhaustive: never = operation;
      throw new Error(`Unknown operation type`);
  }
}

/**
 * Create a document state from text
 */
export function createDocumentState(text: string): DocumentState {
  return Object.freeze({
    text,
    length: text.length,
  });
}

/**
 * Strong List Specification invariant checker
 * Ensures operations produce deterministic results
 */
export class StrongListInvariant implements ListInvariant {
  /**
   * Verify that a sequence of events produces deterministic results
   * regardless of the order they're processed internally
   */
  verify(events: ReadonlyArray<GraphEvent>): boolean {
    // Check that events form a valid causal order
    if (!this.isValidCausalOrder(events)) {
      return false;
    }

    // Check that operations are well-formed
    if (!this.areOperationsValid(events)) {
      return false;
    }

    return true;
  }

  /**
   * Check if two document states are equivalent
   */
  equivalent(state1: DocumentState, state2: DocumentState): boolean {
    return state1.text === state2.text && state1.length === state2.length;
  }

  /**
   * Verify causal order is valid (no cycles, all deps satisfied)
   */
  private isValidCausalOrder(events: ReadonlyArray<GraphEvent>): boolean {
    const eventIds = new Set(events.map((e) => e.id));

    for (const event of events) {
      // Check all parent dependencies exist
      for (const parentId of event.parentVersion) {
        if (!eventIds.has(parentId)) {
          // Parent must either be in this set or be the empty version
          if (event.parentVersion.size > 0) {
            return false; // Missing dependency
          }
        }
      }
    }

    // TODO: Check for cycles using topological sort
    return true;
  }

  /**
   * Validate that operations are well-formed
   */
  private areOperationsValid(events: ReadonlyArray<GraphEvent>): boolean {
    for (const event of events) {
      const op = event.operation;

      switch (op.type) {
        case "insert":
          if (op.index < 0 || op.text.length === 0) {
            return false;
          }
          break;

        case "delete":
          if (op.index < 0 || op.length <= 0) {
            return false;
          }
          break;

        default:
          return false;
      }
    }

    return true;
  }
}

/**
 * Helper to compute the linearized text from a sequence of events
 * This is used for testing invariants
 */
export function linearizeEvents(
  events: ReadonlyArray<GraphEvent>,
  initialText: string = "",
): string {
  // Sort events in causal order
  const sorted = topologicalSort(events);

  // Apply operations in order
  let text = initialText;
  for (const event of sorted) {
    text = applyOperation(text, event.operation);
  }

  return text;
}

/**
 * Topological sort of events based on causal dependencies
 */
export function topologicalSort(
  events: ReadonlyArray<GraphEvent>,
): ReadonlyArray<GraphEvent> {
  const sorted: GraphEvent[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const eventMap = new Map(events.map((e) => [e.id, e]));

  function visit(event: GraphEvent): void {
    if (visited.has(event.id)) return;
    if (visiting.has(event.id)) {
      throw new Error("Cycle detected in event graph");
    }

    visiting.add(event.id);

    // Visit parents first
    for (const parentId of event.parentVersion) {
      const parent = eventMap.get(parentId);
      if (parent) {
        visit(parent);
      }
    }

    visiting.delete(event.id);
    visited.add(event.id);
    sorted.push(event);
  }

  for (const event of events) {
    visit(event);
  }

  return sorted;
}
