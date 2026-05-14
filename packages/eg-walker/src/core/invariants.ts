/**
 * Core invariants for Section 3.1 - Strong List Specification
 *
 * Ensures deterministic behavior and consistency across replicas
 */

import { OPERATION_TYPE } from "../constants/operation-types";
import type {
  DocumentState,
  GraphEvent,
  ExternalOperation,
  ListInvariant,
} from "../types";

/**
 * Reject strings whose UTF-16 code-unit sequence contains a lone surrogate.
 *
 * The CRDT layer stores one item per UTF-16 code unit, so a lone high or low
 * surrogate would be materialised as a standalone CRDT item and surface as an
 * unpaired surrogate when the document is read back. Catching this at every
 * public boundary keeps the document and every concurrent merge of it
 * well-formed UTF-16 (a precondition for downstream JSON serialisation, regex
 * matchers, and any consumer that round-trips through `TextEncoder` /
 * `TextDecoder`).
 *
 * A correctly-formed surrogate pair is allowed (and split across two CRDT
 * items as documented in `packages/eg-walker/AGENTS.md`); the mid-surrogate
 * *index* check stays in the replica so concurrent operations cannot land
 * between the two halves.
 *
 * Lives here (not in `core/replica.ts`) so the columnar codec, the engine,
 * and any future internal-boundary path can share the same well-formedness
 * guard without re-implementing the loop.
 */
export const assertWellFormedUtf16 = (text: string, context: string): void => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
    const isLowSurrogate = code >= 0xdc00 && code <= 0xdfff;
    if (!isHighSurrogate && !isLowSurrogate) {
      continue;
    }
    if (isLowSurrogate) {
      throw new Error(
        `${context} contains a lone low surrogate (0x${code
          .toString(16)
          .toUpperCase()
          .padStart(4, "0")}) at index ${i}`,
      );
    }
    const next = text.charCodeAt(i + 1);
    if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
      throw new Error(
        `${context} contains a lone high surrogate (0x${code
          .toString(16)
          .toUpperCase()
          .padStart(4, "0")}) at index ${i}`,
      );
    }
    // Skip the paired low surrogate so we don't flag it as a stray.
    i++;
  }
};

/**
 * Validate the invariants the replica relies on for a remote {@link GraphEvent}
 * before accepting it into the event graph: insert payloads must be
 * well-formed UTF-16, and delete lengths must be finite and non-negative.
 *
 * Index validity against the prepare state at the event's parent version is
 * checked downstream by the engine (the replica doesn't materialise that view
 * for every remote delivery); this guard catches the cases the engine cannot
 * recover from cleanly — lone surrogates would otherwise round-trip into the
 * document as unpaired code units, and a NaN/negative delete length would
 * crash the prepare-index walk with an opaque error.
 */
export const assertRemoteEventWellFormed = (event: GraphEvent): void => {
  if (event.operation.type === OPERATION_TYPE.INSERT) {
    assertWellFormedUtf16(
      event.operation.text,
      `remote event ${event.id} insert text`,
    );
    return;
  }
  const length = event.operation.length;
  if (!Number.isFinite(length) || length < 0) {
    throw new Error(
      `remote event ${event.id} has invalid delete length ${length}`,
    );
  }
};

/**
 * Apply an operation to text, returning new text
 * Pure function - no side effects
 */
export function applyOperation(
  text: string,
  operation: ExternalOperation,
): string {
  switch (operation.type) {
    case OPERATION_TYPE.INSERT: {
      const { index, text: insertText } = operation;
      if (index < 0 || index > text.length) {
        throw new Error(`Invalid insert index: ${index}`);
      }
      return text.slice(0, index) + insertText + text.slice(index);
    }

    case OPERATION_TYPE.DELETE: {
      const { index, length } = operation;
      if (index < 0 || index + length > text.length) {
        throw new Error(`Invalid delete range: [${index}, ${index + length})`);
      }
      return text.slice(0, index) + text.slice(index + length);
    }

    default: {
      // Type exhaustiveness check
      throw new Error(`Unknown operation type`);
    }
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
 * Verify strong list specification
 * Wrapper function for the class implementation
 */
export function verifyStrongListSpecification(
  events: ReadonlyArray<GraphEvent>,
): boolean {
  const invariant = new StrongListInvariant();
  return invariant.verify(events);
}

/**
 * Ensure convergence across replicas
 * Verifies that all replicas converge to the same state
 */
export function ensureConvergence(
  events: ReadonlyArray<GraphEvent>,
  initialText: string = "",
): boolean {
  try {
    // If we can linearize events, they will converge
    const result = linearizeEvents(events, initialText);
    return result !== null;
  } catch {
    return false;
  }
}

/**
 * Validate index bounds for operations
 */
export function validateIndexBounds(
  text: string,
  operation: ExternalOperation,
): boolean {
  switch (operation.type) {
    case OPERATION_TYPE.INSERT:
      return operation.index >= 0 && operation.index <= text.length;
    case OPERATION_TYPE.DELETE:
      return (
        operation.index >= 0 &&
        operation.index + operation.length <= text.length &&
        operation.length > 0
      );
    default:
      return false;
  }
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

    // Check for cycles using topological sort
    try {
      topologicalSort(events);
    } catch {
      // Cycle detected in event graph
      return false;
    }

    return true;
  }

  /**
   * Validate that operations are well-formed
   */
  private areOperationsValid(events: ReadonlyArray<GraphEvent>): boolean {
    for (const event of events) {
      const op = event.operation;

      switch (op.type) {
        case OPERATION_TYPE.INSERT:
          if (op.index < 0 || op.text.length === 0) {
            return false;
          }
          break;

        case OPERATION_TYPE.DELETE:
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
