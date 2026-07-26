import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import type { EventGraph } from "../graph/event-graph";
import {
  BinaryReader,
  BinaryWriter,
  encodeText,
} from "../graph/internals/binary-io";
import type { EventId } from "../types";
import { assertWellFormedUtf16 } from "./invariants";

export const PORTABLE_SNAPSHOT_FORMAT_VERSION = "EGWP1" as const;

export interface PortableSnapshot {
  readonly formatVersion: typeof PORTABLE_SNAPSHOT_FORMAT_VERSION;
  readonly text: string;
  readonly initialText: string;
  readonly currentVersion: ReadonlyArray<EventId>;
  readonly eventCount: number;
  readonly nextSequenceNumber: number;
  /** EGW3 columnar event graph; never contains runtime CRDT records. */
  readonly eventGraph: Uint8Array;
}

interface PortableSnapshotHeader {
  readonly formatVersion: typeof PORTABLE_SNAPSHOT_FORMAT_VERSION;
  readonly text: string;
  readonly initialText: string;
  readonly currentVersion: ReadonlyArray<EventId>;
  readonly eventCount: number;
  readonly nextSequenceNumber: number;
}

const MAGIC = encodeText(PORTABLE_SNAPSHOT_FORMAT_VERSION);
const codec = new ColumnarEventGraphCodec();
interface PortableSnapshotProof {
  readonly formatVersion: typeof PORTABLE_SNAPSHOT_FORMAT_VERSION;
  readonly text: string;
  readonly initialText: string;
  readonly currentVersion: ReadonlyArray<EventId>;
  readonly eventCount: number;
  readonly nextSequenceNumber: number;
  readonly eventGraph: Uint8Array;
}

const trustedSnapshots = new WeakMap<PortableSnapshot, PortableSnapshotProof>();
const trustedEncodedBytes = new WeakMap<Uint8Array, PortableSnapshotProof>();
const FORBIDDEN_RUNTIME_METADATA = new Set([
  "sequenceRecords",
  "deleteTargets",
  "checkpoints",
  "replayCache",
  "fugueIndex",
  "ropeNodes",
]);

export const assertPortableSnapshotMetadata = (
  metadata: Readonly<Record<string, unknown>>,
): void => {
  for (const key of Object.keys(metadata)) {
    if (FORBIDDEN_RUNTIME_METADATA.has(key)) {
      throw new Error(
        `Invalid portable snapshot: runtime metadata ${key} is forbidden`,
      );
    }
  }
};

export class PortableSnapshotCodec {
  encode(snapshot: PortableSnapshot): Uint8Array {
    const existingProof = matchingProof(snapshot);
    const validated =
      existingProof === null ? validatePortableSnapshot(snapshot) : snapshot;
    const proof = existingProof ?? captureProof(validated);
    trustedSnapshots.set(snapshot, proof);
    const writer = new BinaryWriter();
    writer.writeString(
      JSON.stringify({
        formatVersion: validated.formatVersion,
        text: validated.text,
        initialText: validated.initialText,
        currentVersion: validated.currentVersion,
        eventCount: validated.eventCount,
        nextSequenceNumber: validated.nextSequenceNumber,
      } satisfies PortableSnapshotHeader),
    );
    writer.writeBytes(validated.eventGraph);
    const body = writer.toUint8Array();
    const encoded = new Uint8Array(MAGIC.length + body.length);
    encoded.set(MAGIC, 0);
    encoded.set(body, MAGIC.length);
    trustedEncodedBytes.set(encoded, proof);
    return encoded;
  }

  decode(bytes: Uint8Array): PortableSnapshot {
    if (bytes.length < MAGIC.length) {
      throw new Error("Invalid portable snapshot: missing EGWP1 header");
    }
    for (let index = 0; index < MAGIC.length; index++) {
      if (bytes[index] !== MAGIC[index]) {
        throw new Error("Invalid portable snapshot: missing EGWP1 header");
      }
    }
    const reader = new BinaryReader(bytes.subarray(MAGIC.length));
    const header = parseHeader(reader.readString());
    const eventGraph = reader.readBytes(reader.readVarint());
    if (reader.remainingByteLength !== 0) {
      throw new Error("Invalid portable snapshot: trailing bytes");
    }
    const snapshot = validatePortableSnapshotHeaderOnly({
      ...header,
      eventGraph,
    });
    const proof = trustedEncodedBytes.get(bytes);
    if (proof !== undefined && snapshotMatchesProof(snapshot, proof)) {
      trustedSnapshots.set(snapshot, proof);
    }
    return snapshot;
  }
}

/** @internal Mark a snapshot produced from live replica state as validated. */
export const registerTrustedPortableSnapshot = (
  snapshot: PortableSnapshot,
): PortableSnapshot => {
  trustedSnapshots.set(snapshot, captureProof(snapshot));
  return snapshot;
};

export const validatePortableSnapshot = (
  snapshot: PortableSnapshot,
): PortableSnapshot => {
  if (matchingProof(snapshot) !== null) {
    return validatePortableSnapshotHeaderOnly(snapshot);
  }
  const validated = validatePortableSnapshotHeaderOnly(snapshot);
  const graph = codec.decodeBinary(validated.eventGraph);
  validatePortableSnapshotGraph(graph, validated, true);
  return validated;
};

export const validatePortableSnapshotHeaderOnly = (
  snapshot: PortableSnapshot,
): PortableSnapshot => {
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot)
  ) {
    throw new Error("Invalid portable snapshot: expected an object");
  }
  const value = snapshot as unknown as Record<string, unknown>;
  if (value.formatVersion !== PORTABLE_SNAPSHOT_FORMAT_VERSION) {
    throw new Error("Invalid portable snapshot: unsupported format version");
  }
  if (typeof value.text !== "string" || typeof value.initialText !== "string") {
    throw new Error("Invalid portable snapshot: text fields must be strings");
  }
  assertWellFormedUtf16(value.text, "portable snapshot text");
  assertWellFormedUtf16(value.initialText, "portable snapshot initial text");
  const currentVersion = strictEventIds(
    value.currentVersion,
    "portable snapshot currentVersion",
  );
  if (
    !Number.isSafeInteger(value.eventCount) ||
    (value.eventCount as number) < 0
  ) {
    throw new Error(
      "Invalid portable snapshot: eventCount must be non-negative",
    );
  }
  if (
    !Number.isSafeInteger(value.nextSequenceNumber) ||
    (value.nextSequenceNumber as number) < 0
  ) {
    throw new Error(
      "Invalid portable snapshot: nextSequenceNumber must be non-negative",
    );
  }
  if (!(value.eventGraph instanceof Uint8Array)) {
    throw new Error("Invalid portable snapshot: eventGraph must be EGW3 bytes");
  }

  const validated: PortableSnapshot = {
    formatVersion: PORTABLE_SNAPSHOT_FORMAT_VERSION,
    text: value.text,
    initialText: value.initialText,
    currentVersion,
    eventCount: value.eventCount as number,
    nextSequenceNumber: value.nextSequenceNumber as number,
    eventGraph: value.eventGraph.slice(),
  };
  const proof = matchingProof(snapshot);
  if (proof !== null) {
    trustedSnapshots.set(validated, proof);
  }
  return validated;
};

export const createPortableSnapshotGraphSource = (
  snapshot: PortableSnapshot,
): (() => EventGraph) => {
  let graph: EventGraph | null = null;
  return () => {
    if (graph === null) {
      const decoded = codec.decodeBinary(snapshot.eventGraph);
      validatePortableSnapshotGraph(
        decoded,
        snapshot,
        matchingProof(snapshot) === null,
      );
      graph = decoded;
    }
    return graph;
  };
};

const validatePortableSnapshotGraph = (
  graph: EventGraph,
  snapshot: PortableSnapshot,
  validateMaterializedText: boolean,
): void => {
  try {
    if (graph.getEventCount() !== snapshot.eventCount) {
      throw new Error("Invalid portable snapshot: event count mismatch");
    }
    if (!sameIds(graph.getFrontier(), new Set(snapshot.currentVersion))) {
      throw new Error("Invalid portable snapshot: frontier mismatch");
    }
    assertPortableSnapshotMetadata(graph.getMetadata());
    if (validateMaterializedText) {
      const eventOrder = graph.getBranchPreservingTopologicalOrder();
      const generated = new EgWalkerEngine().generate(
        eventOrder,
        snapshot.initialText,
        { eventGraph: graph, eventOrder },
      );
      if (generated.text !== snapshot.text) {
        throw new Error(
          "Invalid portable snapshot: materialized text mismatch",
        );
      }
    }
  } finally {
    graph.releaseTraversalCaches();
  }
};

const captureProof = (snapshot: PortableSnapshot): PortableSnapshotProof => ({
  formatVersion: snapshot.formatVersion,
  text: snapshot.text,
  initialText: snapshot.initialText,
  currentVersion: [...snapshot.currentVersion],
  eventCount: snapshot.eventCount,
  nextSequenceNumber: snapshot.nextSequenceNumber,
  eventGraph: snapshot.eventGraph.slice(),
});

const matchingProof = (
  snapshot: PortableSnapshot,
): PortableSnapshotProof | null => {
  if (
    snapshot === null ||
    (typeof snapshot !== "object" && typeof snapshot !== "function")
  ) {
    return null;
  }
  const proof = trustedSnapshots.get(snapshot);
  return proof !== undefined && snapshotMatchesProof(snapshot, proof)
    ? proof
    : null;
};

const snapshotMatchesProof = (
  snapshot: PortableSnapshot,
  proof: PortableSnapshotProof,
): boolean =>
  Array.isArray(snapshot.currentVersion) &&
  snapshot.eventGraph instanceof Uint8Array &&
  snapshot.formatVersion === proof.formatVersion &&
  snapshot.text === proof.text &&
  snapshot.initialText === proof.initialText &&
  snapshot.eventCount === proof.eventCount &&
  snapshot.nextSequenceNumber === proof.nextSequenceNumber &&
  equalArrays(snapshot.currentVersion, proof.currentVersion) &&
  equalBytes(snapshot.eventGraph, proof.eventGraph);

const equalArrays = <T>(
  left: ReadonlyArray<T>,
  right: ReadonlyArray<T>,
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
};

const parseHeader = (json: string): PortableSnapshotHeader => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new Error("Invalid portable snapshot: malformed JSON header");
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("Invalid portable snapshot: malformed header");
  }
  const header = parsed as Record<string, unknown>;
  return {
    formatVersion:
      header.formatVersion as typeof PORTABLE_SNAPSHOT_FORMAT_VERSION,
    text: header.text as string,
    initialText: header.initialText as string,
    currentVersion: header.currentVersion as ReadonlyArray<EventId>,
    eventCount: header.eventCount as number,
    nextSequenceNumber: header.nextSequenceNumber as number,
  };
};

const strictEventIds = (value: unknown, context: string): EventId[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid portable snapshot: ${context} must be an array`);
  }
  const seen = new Set<EventId>();
  return value.map((id) => {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) {
      throw new Error(`Invalid portable snapshot: ${context} is invalid`);
    }
    seen.add(id);
    return id;
  });
};

const sameIds = (
  left: ReadonlySet<EventId>,
  right: ReadonlySet<EventId>,
): boolean => {
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
};
