import { OPERATION_TYPE } from "../constants/operation-types";
import { assertWellFormedUtf16 } from "../core/invariants";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { EventGraph } from "../graph/event-graph";
import type { EventId, ExternalOperation, GraphEvent } from "../types";

/**
 * The identity used by the paper's event model. It deliberately remains
 * separate from the package's production {@link EventId}: adapting a graph is
 * a conformance/benchmark concern and never rewrites the stored source graph.
 */
export interface PaperEventIdentity {
  readonly sourceEventId: EventId;
  readonly offset: number;
}

export interface PaperEventExpansion {
  /** Atomic Unicode-scalar events suitable for the existing replay engine. */
  readonly events: ReadonlyArray<GraphEvent>;
  /** Structured adapter-only identity for every event in {@link events}. */
  readonly identities: ReadonlyMap<EventId, PaperEventIdentity>;
}

/**
 * Expand the package's compound UTF-16 operations into the paper's
 * one-Unicode-scalar-per-event model.
 *
 * The first scalar keeps the source event ID. This preserves the production
 * ID tie-break between concurrent siblings. Later scalars receive transient,
 * collision-free IDs and form a causal chain. Children of a compound event
 * depend on the chain's tail; children of an empty no-op inherit its remapped
 * parent frontier.
 */
export class PaperEventAdapter {
  constructor(private readonly initialText: string = "") {
    assertWellFormedUtf16(initialText, "PaperEventAdapter initial text");
  }

  expand(sourceEvents: ReadonlyArray<GraphEvent>): PaperEventExpansion {
    const sourceGraph = EventGraph.fromEvents(sourceEvents);
    const orderedSources = sourceGraph.getTopologicalOrder();
    const derivedNamespace = chooseDerivedNamespace(orderedSources);
    const expandedEvents: GraphEvent[] = [];
    const identities = new Map<EventId, PaperEventIdentity>();
    const terminalVersions = new Map<EventId, ReadonlySet<EventId>>();

    for (const sourceEvent of orderedSources) {
      const parentVersion = remapParentVersion(sourceEvent, terminalVersions);
      const parentText = materializeVersionText(
        expandedEvents,
        parentVersion,
        this.initialText,
      );
      const operations = expandOperation(sourceEvent, parentText);

      let atomicParentVersion = parentVersion;
      for (let offset = 0; offset < operations.length; offset++) {
        const identity: PaperEventIdentity = Object.freeze({
          sourceEventId: sourceEvent.id,
          offset,
        });
        const id =
          offset === 0
            ? sourceEvent.id
            : derivedEventId(derivedNamespace, identity);
        const event: GraphEvent = {
          id,
          operation: operations[offset]!,
          parentVersion: new Set(atomicParentVersion),
          timestamp: sourceEvent.timestamp,
        };
        expandedEvents.push(event);
        identities.set(id, identity);
        atomicParentVersion = new Set([id]);
      }

      terminalVersions.set(sourceEvent.id, atomicParentVersion);
    }

    return {
      events: Object.freeze(expandedEvents),
      identities,
    };
  }
}

const chooseDerivedNamespace = (
  sourceEvents: ReadonlyArray<GraphEvent>,
): string => {
  let namespace = "__egw_paper_scalar__";
  const sourceIds = new Set(sourceEvents.map(({ id }) => id));
  while (Array.from(sourceIds).some((id) => id.startsWith(namespace))) {
    namespace = `_${namespace}`;
  }
  return namespace;
};

const derivedEventId = (
  namespace: string,
  identity: PaperEventIdentity,
): EventId =>
  `${namespace}${JSON.stringify([identity.sourceEventId, identity.offset])}`;

const remapParentVersion = (
  sourceEvent: GraphEvent,
  terminalVersions: ReadonlyMap<EventId, ReadonlySet<EventId>>,
): Set<EventId> => {
  const result = new Set<EventId>();
  for (const sourceParentId of sourceEvent.parentVersion) {
    const terminalVersion = terminalVersions.get(sourceParentId);
    if (terminalVersion === undefined) {
      throw new Error(
        `PaperEventAdapter cannot resolve parent ${sourceParentId} of ${sourceEvent.id}`,
      );
    }
    for (const terminalId of terminalVersion) {
      result.add(terminalId);
    }
  }
  return result;
};

const expandOperation = (
  event: GraphEvent,
  parentText: string,
): ExternalOperation[] => {
  const { operation } = event;
  assertIndexAtScalarBoundary(parentText, operation.index, event.id);

  if (operation.type === OPERATION_TYPE.INSERT) {
    assertWellFormedUtf16(
      operation.text,
      `PaperEventAdapter source event ${event.id} insert text`,
    );
    let utf16Index = operation.index;
    return Array.from(operation.text, (scalar) => {
      const atomicOperation: ExternalOperation = {
        type: OPERATION_TYPE.INSERT,
        index: utf16Index,
        text: scalar,
      };
      utf16Index += scalar.length;
      return atomicOperation;
    });
  }

  if (!Number.isSafeInteger(operation.length) || operation.length < 0) {
    throw new Error(
      `PaperEventAdapter source event ${event.id} has invalid delete length ${operation.length}`,
    );
  }
  const end = operation.index + operation.length;
  if (!Number.isSafeInteger(end) || end > parentText.length) {
    throw new Error(
      `PaperEventAdapter source event ${event.id} delete range ${operation.index}..${end} exceeds parent text length ${parentText.length}`,
    );
  }
  assertIndexAtScalarBoundary(parentText, end, event.id);
  const deletedScalars = Array.from(parentText.slice(operation.index, end));
  return deletedScalars.map((scalar) => ({
    type: OPERATION_TYPE.DELETE,
    index: operation.index,
    length: scalar.length,
  }));
};

const assertIndexAtScalarBoundary = (
  text: string,
  index: number,
  eventId: EventId,
): void => {
  if (!Number.isSafeInteger(index) || index < 0 || index > text.length) {
    throw new Error(
      `PaperEventAdapter source event ${eventId} has invalid UTF-16 index ${index}`,
    );
  }
  if (index === 0 || index === text.length) {
    return;
  }
  const before = text.charCodeAt(index - 1);
  const after = text.charCodeAt(index);
  if (
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  ) {
    throw new Error(
      `PaperEventAdapter source event ${eventId} index ${index} splits a Unicode scalar`,
    );
  }
};

const materializeVersionText = (
  events: ReadonlyArray<GraphEvent>,
  version: ReadonlySet<EventId>,
  initialText: string,
): string => {
  if (events.length === 0 || version.size === 0) {
    return initialText;
  }
  const graph = EventGraph.fromEvents(events);
  const included = graph.expandVersion(version);
  const ordered = graph
    .getBranchPreservingTopologicalOrder()
    .filter(({ id }) => included.has(id));
  const versionGraph = EventGraph.fromEvents(ordered);
  return new EgWalkerEngine().generate(ordered, initialText, {
    eventGraph: versionGraph,
    eventOrder: ordered,
  }).text;
};
