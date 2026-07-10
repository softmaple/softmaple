/**
 * Core invariants for Section 3.1 - Strong List Specification
 *
 * Ensures deterministic behavior and consistency across replicas
 */

import { OPERATION_TYPE } from "../constants/operation-types";
import type { DocumentState, GraphEvent, ExternalOperation } from "../types";

/**
 * Validate and detach a caller-owned event before it can enter replica state.
 */
export const cloneRemoteEvent = (event: GraphEvent): GraphEvent => {
  const candidate = event as unknown as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    throw new Error("remote event id must be a non-empty string");
  }
  if (!(candidate.parentVersion instanceof Set)) {
    throw new Error(
      `remote event ${candidate.id} parentVersion must be a Set of event IDs`,
    );
  }
  const parents = new Set<string>();
  for (const parent of candidate.parentVersion) {
    if (typeof parent !== "string" || parent.length === 0) {
      throw new Error(
        `remote event ${candidate.id} has a non-string parent event ID`,
      );
    }
    if (parent === candidate.id) {
      throw new Error(`remote event ${candidate.id} cannot parent itself`);
    }
    parents.add(parent);
  }
  if (
    typeof candidate.timestamp !== "number" ||
    !Number.isFinite(candidate.timestamp)
  ) {
    throw new Error(`remote event ${candidate.id} has an invalid timestamp`);
  }
  if (candidate.operation === null || typeof candidate.operation !== "object") {
    throw new Error(`remote event ${candidate.id} has an invalid operation`);
  }
  const operation = candidate.operation as Record<string, unknown>;
  let clonedOperation: ExternalOperation;
  if (operation.type === OPERATION_TYPE.INSERT) {
    if (
      typeof operation.index !== "number" ||
      typeof operation.text !== "string"
    ) {
      throw new Error(`remote event ${candidate.id} has an invalid insert`);
    }
    clonedOperation = {
      type: OPERATION_TYPE.INSERT,
      index: operation.index,
      text: operation.text,
    };
  } else if (operation.type === OPERATION_TYPE.DELETE) {
    if (
      typeof operation.index !== "number" ||
      typeof operation.length !== "number"
    ) {
      throw new Error(`remote event ${candidate.id} has an invalid delete`);
    }
    clonedOperation = {
      type: OPERATION_TYPE.DELETE,
      index: operation.index,
      length: operation.length,
    };
  } else {
    throw new Error(
      `remote event ${candidate.id} has an unknown operation type`,
    );
  }

  const cloned: GraphEvent = {
    id: candidate.id,
    operation: clonedOperation,
    parentVersion: parents,
    timestamp: candidate.timestamp,
  };
  assertRemoteEventWellFormed(cloned);
  return cloned;
};

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
  const index = event.operation.index;
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(
      `remote event ${event.id} has invalid operation index ${index}`,
    );
  }

  if (event.operation.type === OPERATION_TYPE.INSERT) {
    assertWellFormedUtf16(
      event.operation.text,
      `remote event ${event.id} insert text`,
    );
    return;
  }
  const length = event.operation.length;
  if (!Number.isSafeInteger(length) || length < 0) {
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
