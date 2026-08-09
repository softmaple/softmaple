/**
 * Stable sequence anchors for advanced editor integrations.
 *
 * Anchors name UTF-16 atoms by the insert event that created them. The
 * character-level replay state used to resolve an anchor is reconstructed on
 * demand from the persistent event graph and can be discarded immediately.
 */

import { OPERATION_TYPE } from "./constants/operation-types";
import { EgWalkerReplica } from "./core/replica";
import { EgWalkerEngine } from "./engine/eg-walker-engine";
import { PLACEHOLDER_EVENT_ID } from "./engine/internals/engine-types";
import type { EngineSequenceRecord } from "./engine/sequence-records";
import { EventGraph } from "./graph/event-graph";
import type { EventId, GraphEvent } from "./types";

export type AnchorAffinity = "before" | "after";

/**
 * The referenced insert event is not present in the replica's integrated
 * event graph. Ephemeral consumers (e.g. remote presence) may treat this as
 * temporarily unresolved until document state catches up.
 */
export class UnknownSequenceAtomError extends Error {
  override readonly name = "UnknownSequenceAtomError";

  constructor(
    readonly eventId: EventId,
    readonly offset: number,
  ) {
    super(`Sequence anchor references unknown atom ${eventId}:${offset}`);
  }
}

/**
 * The referenced event is known to the replica, but the atom offset does not
 * exist in the sequence projection (wrong offset, non-insert event, etc.).
 * This is not a transient catch-up failure.
 */
export class InvalidSequenceAtomError extends Error {
  override readonly name = "InvalidSequenceAtomError";

  constructor(
    readonly eventId: EventId,
    readonly offset: number,
  ) {
    super(`Sequence anchor references invalid atom ${eventId}:${offset}`);
  }
}

export interface AtomSequenceAnchor {
  readonly type: "atom";
  readonly eventId: EventId;
  /** UTF-16 code-unit offset inside the creating insert event. */
  readonly offset: number;
  readonly affinity: AnchorAffinity;
}

export interface StartBoundarySequenceAnchor {
  readonly type: "boundary";
  readonly edge: "start";
  readonly affinity: "after";
}

export interface EndBoundarySequenceAnchor {
  readonly type: "boundary";
  readonly edge: "end";
  readonly affinity: "before";
}

export type BoundarySequenceAnchor =
  | StartBoundarySequenceAnchor
  | EndBoundarySequenceAnchor;

/** JSON-safe stable location between UTF-16 atoms. */
export type SequenceAnchor = AtomSequenceAnchor | BoundarySequenceAnchor;

export interface SequenceAnchorRange {
  readonly start: SequenceAnchor;
  readonly end: SequenceAnchor;
}

export interface LocalInsertWithAnchorsResult {
  readonly event: GraphEvent;
  /** Stable half-open range naming exactly the newly inserted atoms. */
  readonly range: SequenceAnchorRange;
}

export interface SequenceAnchorApi {
  captureAnchor(index: number, affinity: AnchorAffinity): SequenceAnchor;
  resolveAnchor(anchor: SequenceAnchor): number;
  /**
   * Like {@link resolveAnchor}, but returns `null` when the atom's creating
   * event has not been integrated yet. Invalid anchors still throw.
   */
  tryResolveAnchor(anchor: SequenceAnchor): number | null;
  insert(index: number, text: string): LocalInsertWithAnchorsResult | null;
  delete(index: number, length: number): GraphEvent | null;
  getFrontier(): ReadonlySet<EventId>;
}

/**
 * Immutable character projection that resolves many anchors with one replay.
 *
 * Create one projection for a logical editor update, resolve every anchor
 * needed by that update, and then discard it. A projection is a snapshot: it
 * does not observe edits applied to the replica after construction.
 */
export interface SequenceAnchorProjection {
  readonly text: string;
  captureAnchor(index: number, affinity: AnchorAffinity): SequenceAnchor;
  resolveAnchor(anchor: SequenceAnchor): number;
  /**
   * Resolve an anchor against this projection, or return `null` when the
   * atom's creating event is not present. Invalid anchors (bad shape, known
   * event with a missing offset, etc.) still throw.
   */
  tryResolveAnchor(anchor: SequenceAnchor): number | null;
}

interface SequenceAtom {
  readonly eventId: EventId;
  readonly offset: number;
  readonly deleted: boolean;
  readonly codeUnit: string;
}

interface SequenceAtomPosition {
  readonly before: number;
  readonly after: number;
}

interface SequenceProjection {
  readonly visibleAtoms: ReadonlyArray<SequenceAtom>;
  readonly atomPositions: ReadonlyMap<
    EventId,
    ReadonlyMap<number, SequenceAtomPosition>
  >;
  readonly knownEventIds: ReadonlySet<EventId>;
  readonly text: string;
}

/**
 * Bind the anchor helpers to one replica while keeping Lexical/editor state
 * outside the EG-walker package.
 */
export const createSequenceAnchorApi = (
  replica: EgWalkerReplica,
): SequenceAnchorApi => ({
  captureAnchor: (index, affinity) => captureAnchor(replica, index, affinity),
  resolveAnchor: (anchor) => resolveAnchor(replica, anchor),
  tryResolveAnchor: (anchor) => tryResolveAnchor(replica, anchor),
  insert: (index, text) => insertWithAnchors(replica, index, text),
  delete: (index, length) => replica.delete(index, length),
  getFrontier: () => replica.getFrontier(),
});

/** Capture a stable anchor at a visible UTF-16 boundary. */
export const captureAnchor = (
  replica: EgWalkerReplica,
  index: number,
  affinity: AnchorAffinity,
): SequenceAnchor =>
  createSequenceAnchorProjection(replica).captureAnchor(index, affinity);

/**
 * Reconstruct one immutable sequence projection for batched anchor work.
 */
export const createSequenceAnchorProjection = (
  replica: EgWalkerReplica,
): SequenceAnchorProjection => {
  const projection = createProjection(replica);
  return Object.freeze({
    text: projection.text,
    captureAnchor: (index: number, affinity: AnchorAffinity): SequenceAnchor =>
      captureProjectedAnchor(projection, index, affinity),
    resolveAnchor: (anchor: SequenceAnchor): number =>
      resolveProjectedAnchor(projection, anchor),
    tryResolveAnchor: (anchor: SequenceAnchor): number | null =>
      tryResolveProjectedAnchor(projection, anchor),
  });
};

const captureProjectedAnchor = (
  projection: SequenceProjection,
  index: number,
  affinity: AnchorAffinity,
): SequenceAnchor => {
  assertAffinity(affinity);
  assertBoundary(index, projection.text);

  if (affinity === "before") {
    const next = projection.visibleAtoms[index];
    return next === undefined
      ? { type: "boundary", edge: "end", affinity }
      : atomAnchor(next, affinity);
  }

  const previous = projection.visibleAtoms[index - 1];
  return previous === undefined
    ? { type: "boundary", edge: "start", affinity }
    : atomAnchor(previous, affinity);
};

/** Resolve an anchor against the replica's current converged sequence. */
export const resolveAnchor = (
  replica: EgWalkerReplica,
  anchor: SequenceAnchor,
): number => createSequenceAnchorProjection(replica).resolveAnchor(anchor);

/**
 * Resolve an anchor, or return `null` when its creating event is not yet in
 * the replica. Shape errors and known-but-invalid atoms still throw so callers
 * can distinguish transient catch-up from corruption / malformed presence.
 */
export const tryResolveAnchor = (
  replica: EgWalkerReplica,
  anchor: SequenceAnchor,
): number | null =>
  createSequenceAnchorProjection(replica).tryResolveAnchor(anchor);

const resolveProjectedAnchor = (
  projection: SequenceProjection,
  anchor: SequenceAnchor,
): number => {
  const resolved = tryResolveProjectedAnchor(projection, anchor);
  if (resolved !== null) {
    return resolved;
  }
  if (anchor.type !== "atom") {
    throw new Error("Expected an atom sequence anchor");
  }
  throw new UnknownSequenceAtomError(anchor.eventId, anchor.offset);
};

const tryResolveProjectedAnchor = (
  projection: SequenceProjection,
  anchor: SequenceAnchor,
): number | null => {
  assertSequenceAnchor(anchor);
  if (anchor.type === "boundary") {
    return anchor.edge === "start" ? 0 : projection.text.length;
  }

  const eventAtoms = projection.atomPositions.get(anchor.eventId);
  const position = eventAtoms?.get(anchor.offset);
  if (position !== undefined) {
    const resolved =
      anchor.affinity === "after" ? position.after : position.before;
    assertBoundary(resolved, projection.text);
    return resolved;
  }

  // Event is integrated (or otherwise known to the projection) but this atom
  // offset does not exist — malformed / corrupted anchor, not catch-up.
  if (
    eventAtoms !== undefined ||
    projection.knownEventIds.has(anchor.eventId)
  ) {
    throw new InvalidSequenceAtomError(anchor.eventId, anchor.offset);
  }

  // Creating event is absent from the integrated graph: presence may arrive
  // before the corresponding document collaboration event.
  return null;
};

/**
 * Apply a local insert and return both its persistent graph event and the
 * stable range covering its UTF-16 atoms.
 */
export const insertWithAnchors = (
  replica: EgWalkerReplica,
  index: number,
  text: string,
): LocalInsertWithAnchorsResult | null => {
  assertStableBootstrap(replica);
  const event = replica.insert(index, text);
  if (event === null) {
    return null;
  }
  if (event.operation.type !== OPERATION_TYPE.INSERT) {
    throw new Error(`Local insert produced non-insert event ${event.id}`);
  }
  return {
    event,
    range: {
      start: {
        type: "atom",
        eventId: event.id,
        offset: 0,
        affinity: "before",
      },
      end: {
        type: "atom",
        eventId: event.id,
        offset: text.length - 1,
        affinity: "after",
      },
    },
  };
};

/** Runtime validator for anchors crossing JSON/wire boundaries. */
export const isSequenceAnchor = (value: unknown): value is SequenceAnchor => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.affinity !== "before" && candidate.affinity !== "after") {
    return false;
  }
  if (candidate.type === "boundary") {
    return (
      (candidate.edge === "start" && candidate.affinity === "after") ||
      (candidate.edge === "end" && candidate.affinity === "before")
    );
  }
  return (
    candidate.type === "atom" &&
    typeof candidate.eventId === "string" &&
    candidate.eventId.length > 0 &&
    Number.isSafeInteger(candidate.offset) &&
    (candidate.offset as number) >= 0
  );
};

const assertSequenceAnchor = (anchor: SequenceAnchor): void => {
  if (!isSequenceAnchor(anchor)) {
    throw new Error("Invalid sequence anchor");
  }
};

const assertAffinity = (affinity: AnchorAffinity): void => {
  if (affinity !== "before" && affinity !== "after") {
    throw new Error(`Invalid anchor affinity ${String(affinity)}`);
  }
};

const assertBoundary = (index: number, text: string): void => {
  if (!Number.isSafeInteger(index) || index < 0 || index > text.length) {
    throw new Error(`Anchor index ${index} out of bounds [0, ${text.length}]`);
  }
  if (
    index > 0 &&
    index < text.length &&
    isHighSurrogate(text.charCodeAt(index - 1)) &&
    isLowSurrogate(text.charCodeAt(index))
  ) {
    throw new Error(`Anchor index ${index} splits a UTF-16 surrogate pair`);
  }
};

const isHighSurrogate = (codeUnit: number): boolean =>
  codeUnit >= 0xd800 && codeUnit <= 0xdbff;

const isLowSurrogate = (codeUnit: number): boolean =>
  codeUnit >= 0xdc00 && codeUnit <= 0xdfff;

const atomAnchor = (
  atom: SequenceAtom,
  affinity: AnchorAffinity,
): AtomSequenceAnchor => ({
  type: "atom",
  eventId: atom.eventId,
  offset: atom.offset,
  affinity,
});

const createProjection = (replica: EgWalkerReplica): SequenceProjection => {
  assertStableBootstrap(replica);
  const graph = graphFromEvents(replica.exportEventGraph());
  const eventOrder = graph.getBranchPreservingTopologicalOrder();
  const engine = new EgWalkerEngine();
  const generated = engine.generate(eventOrder, "", {
    eventGraph: graph,
    eventOrder,
    collectTransformedOperations: false,
  });
  if (generated.text !== replica.getText()) {
    throw new Error(
      "Stable anchor replay disagrees with the replica document; seed content must be a deterministic insert event",
    );
  }

  const events = new Map(eventOrder.map((event) => [event.id, event]));
  const atoms = engine
    .getSequenceRecords()
    .flatMap((record) => atomsFromRecord(record, events));
  const visibleAtoms = atoms.filter((atom) => !atom.deleted);
  const atomPositions = indexAtomPositions(atoms);
  const visibleText = visibleAtoms.map((atom) => atom.codeUnit).join("");
  if (visibleText !== generated.text) {
    throw new Error(
      "Stable anchor projection failed to reproduce document text",
    );
  }
  return {
    visibleAtoms,
    atomPositions,
    knownEventIds: new Set(events.keys()),
    text: visibleText,
  };
};

const indexAtomPositions = (
  atoms: ReadonlyArray<SequenceAtom>,
): ReadonlyMap<EventId, ReadonlyMap<number, SequenceAtomPosition>> => {
  const positions = new Map<EventId, Map<number, SequenceAtomPosition>>();
  let visibleIndex = 0;

  for (const atom of atoms) {
    const eventPositions = positions.get(atom.eventId) ?? new Map();
    if (eventPositions.has(atom.offset)) {
      throw new Error(
        `Stable anchor projection contains duplicate atom ${atom.eventId}:${atom.offset}`,
      );
    }
    eventPositions.set(
      atom.offset,
      Object.freeze({
        before: visibleIndex,
        after: visibleIndex + (atom.deleted ? 0 : 1),
      }),
    );
    positions.set(atom.eventId, eventPositions);
    if (!atom.deleted) {
      visibleIndex++;
    }
  }

  return positions;
};

const assertStableBootstrap = (replica: EgWalkerReplica): void => {
  if (replica.getInitialText().length !== 0) {
    throw new Error(
      "Stable anchors require empty initialText; create seed content with a deterministic bootstrap insert event",
    );
  }
};

const graphFromEvents = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const graph = new EventGraph();
  for (const event of events) {
    graph.addEvent(event);
  }
  return graph;
};

const atomsFromRecord = (
  record: EngineSequenceRecord,
  events: ReadonlyMap<EventId, GraphEvent>,
): SequenceAtom[] => {
  const owningEvent = events.get(record.eventId);
  if (owningEvent === undefined) {
    throw new Error(
      record.eventId === PLACEHOLDER_EVENT_ID
        ? "Stable anchors cannot identify initialText/checkpoint placeholder atoms"
        : `Sequence record references unknown event ${record.eventId}`,
    );
  }

  if (record.run !== null) {
    const atoms = Array.from(
      { length: record.content.length },
      (_, offsetInRecord) => ({
        eventId: `${record.run!.replicaId}:${
          record.run!.startSequence + offsetInRecord
        }`,
        offset: 0,
        deleted: record.everDeleted,
        codeUnit: record.content[offsetInRecord]!,
      }),
    );
    for (const atom of atoms) {
      const event = events.get(atom.eventId);
      if (
        event?.operation.type !== OPERATION_TYPE.INSERT ||
        event.operation.text[atom.offset] !== atom.codeUnit
      ) {
        throw new Error(
          `Typed sequence record ${record.id} disagrees with insert ${atom.eventId}`,
        );
      }
    }
    return atoms;
  }

  if (owningEvent.operation.type !== OPERATION_TYPE.INSERT) {
    throw new Error(`Sequence record references non-insert ${record.eventId}`);
  }
  const offset = recordOffset(record);
  const atoms = Array.from(
    { length: record.content.length },
    (_, offsetInRecord) => ({
      eventId: record.eventId,
      offset: offset + offsetInRecord,
      deleted: record.everDeleted,
      codeUnit: record.content[offsetInRecord]!,
    }),
  );
  for (const atom of atoms) {
    if (owningEvent.operation.text[atom.offset] !== atom.codeUnit) {
      throw new Error(
        `Sequence record ${record.id} disagrees with insert ${record.eventId}`,
      );
    }
  }
  return atoms;
};

const recordOffset = (record: EngineSequenceRecord): number => {
  const prefix = `${record.eventId}:`;
  if (!record.id.startsWith(prefix)) {
    throw new Error(`Sequence record ${record.id} has no stable atom offset`);
  }
  const suffix = record.id.slice(prefix.length);
  if (!/^(0|[1-9]\d*)$/.test(suffix)) {
    throw new Error(`Sequence record ${record.id} has an invalid atom offset`);
  }
  const offset = Number(suffix);
  if (!Number.isSafeInteger(offset)) {
    throw new Error(`Sequence record ${record.id} atom offset is unsafe`);
  }
  return offset;
};
