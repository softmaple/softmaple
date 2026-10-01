import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import type { EventGraph } from "../graph/event-graph";
import {
  BinaryReader,
  BinaryWriter,
  encodeText,
} from "../graph/internals/binary-io";
import type { Steps } from "../graph/internals/steps";
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
  /**
   * Columnar event graph: EGW4, or EGW3 in snapshots written before EGW4.
   * Never contains runtime CRDT records.
   */
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

/**
 * @internal Encode EGWP1 bytes. A snapshot without a validation proof is
 * header-checked and then passed to `validateUntrusted`, which must prove
 * its graph and text (see `PortableSnapshotCodec`).
 */
export const encodePortableSnapshot = (
  snapshot: PortableSnapshot,
  validateUntrusted: (snapshot: PortableSnapshot) => PortableSnapshot,
): Uint8Array => {
  const existingProof = matchingProof(snapshot);
  const validated =
    existingProof === null
      ? validateUntrusted(validatePortableSnapshotHeaderOnly(snapshot))
      : snapshot;
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
};

/**
 * @internal Decode EGWP1 bytes and check the header. The graph is decoded
 * and proven only when a replica or the codec needs it.
 */
export const decodePortableSnapshot = (bytes: Uint8Array): PortableSnapshot => {
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
};

/** @internal Mark a snapshot produced from live replica state as validated. */
export const registerTrustedPortableSnapshot = (
  snapshot: PortableSnapshot,
): PortableSnapshot => {
  trustedSnapshots.set(snapshot, captureProof(snapshot));
  return snapshot;
};

/**
 * Prefix of every authenticated message, so a tag over EGWP1 bytes is never
 * a valid tag for anything else an application authenticates with the same
 * key, and the other way round.
 */
const AUTHENTICATION_CONTEXT = encodeText(
  "softmaple eg-walker EGWP1 snapshot authentication v1\u0000",
);

/**
 * @internal HMAC-SHA-256 tag over EGWP1 bytes. Bytes this process encoded
 * from a validated snapshot are tagged as they are. Any other bytes are
 * decoded and passed to `validateUntrusted`, which must prove their graph
 * and text, so a tag is only ever made for a snapshot that was proven.
 */
export const authenticatePortableSnapshot = async (
  bytes: Uint8Array,
  key: CryptoKey,
  validateUntrusted: (snapshot: PortableSnapshot) => PortableSnapshot,
): Promise<Uint8Array> => {
  const subtle = requireSubtleCrypto();
  assertAuthenticationKey(key);
  // Everything below reads this private copy, so the caller cannot change
  // the bytes between the proof and the tag.
  const message = authenticatedMessage(bytes);
  const snapshot = decodePortableSnapshot(
    message.subarray(AUTHENTICATION_CONTEXT.length),
  );
  const proof = trustedEncodedBytes.get(bytes);
  if (proof === undefined || !snapshotMatchesProof(snapshot, proof)) {
    validateUntrusted(snapshot);
  }
  return new Uint8Array(await subtle.sign("HMAC", key, message));
};

/**
 * @internal Decode EGWP1 bytes whose HMAC-SHA-256 `tag` verifies under
 * `key`, and trust the snapshot: a replica restores it without replaying
 * its history to prove the text.
 */
export const decodeAuthenticatedPortableSnapshot = async (
  bytes: Uint8Array,
  tag: Uint8Array,
  key: CryptoKey,
): Promise<PortableSnapshot> => {
  const subtle = requireSubtleCrypto();
  assertAuthenticationKey(key);
  if (!(tag instanceof Uint8Array)) {
    throw new TypeError(
      "Invalid portable snapshot: authentication tag must be a Uint8Array",
    );
  }
  const message = authenticatedMessage(bytes);
  if (!(await subtle.verify("HMAC", key, tag.slice(), message))) {
    throw new Error(
      "Invalid portable snapshot: authentication tag does not match",
    );
  }
  return registerTrustedPortableSnapshot(
    decodePortableSnapshot(message.subarray(AUTHENTICATION_CONTEXT.length)),
  );
};

const authenticatedMessage = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("Invalid portable snapshot: expected EGWP1 bytes");
  }
  const message = new Uint8Array(AUTHENTICATION_CONTEXT.length + bytes.length);
  message.set(AUTHENTICATION_CONTEXT, 0);
  message.set(bytes, AUTHENTICATION_CONTEXT.length);
  return message;
};

const requireSubtleCrypto = (): SubtleCrypto => {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto
    ?.subtle;
  if (subtle === undefined) {
    throw new Error(
      "Portable snapshot authentication needs Web Crypto (crypto.subtle), which this runtime does not provide",
    );
  }
  return subtle;
};

const assertAuthenticationKey = (key: CryptoKey): void => {
  const algorithm = (key as { algorithm?: Partial<HmacKeyAlgorithm> } | null)
    ?.algorithm;
  if (algorithm?.name !== "HMAC" || algorithm.hash?.name !== "SHA-256") {
    throw new TypeError(
      "Portable snapshot authentication needs an HMAC SHA-256 CryptoKey",
    );
  }
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
    throw new Error(
      "Invalid portable snapshot: eventGraph must be columnar graph bytes",
    );
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

/**
 * Decode a header-validated snapshot's columnar graph and check its event count,
 * frontier and metadata against the header.
 *
 * The text is not replayed here. It is proven by the sectioned cold replay
 * of the replica that owns the graph, so a restored replica keeps what that
 * replay builds instead of replaying history again for its first divergent
 * edit (see {@link portableSnapshotRequiresTextValidation}).
 */
export const decodePortableSnapshotGraph = (
  snapshot: PortableSnapshot,
): EventGraph =>
  checkDecodedGraph(
    // A graph declaring more events than the header is rejected before its
    // columns are allocated, so the header count bounds what a restore
    // decodes.
    codec.decodeBinary(snapshot.eventGraph, {
      maxEvents: snapshot.eventCount,
    }),
    snapshot,
  );

/**
 * {@link decodePortableSnapshotGraph} in steps, for a caller that must
 * pause between them.
 */
export function* decodePortableSnapshotGraphSteps(
  snapshot: PortableSnapshot,
): Steps<EventGraph> {
  const graph = yield* codec.decodeBinarySteps(snapshot.eventGraph, {
    maxEvents: snapshot.eventCount,
  });
  return checkDecodedGraph(graph, snapshot);
}

const checkDecodedGraph = (
  graph: EventGraph,
  snapshot: PortableSnapshot,
): EventGraph => {
  try {
    if (graph.getEventCount() !== snapshot.eventCount) {
      throw new Error("Invalid portable snapshot: event count mismatch");
    }
    if (!sameIds(graph.getFrontier(), new Set(snapshot.currentVersion))) {
      throw new Error("Invalid portable snapshot: frontier mismatch");
    }
    assertPortableSnapshotMetadata(graph.getMetadata());
  } finally {
    graph.releaseTraversalCaches();
  }
  return graph;
};

/** Decode a snapshot's graph on demand; see {@link decodePortableSnapshotGraph}. */
export const createPortableSnapshotGraphSource =
  (snapshot: PortableSnapshot): (() => EventGraph) =>
  () =>
    decodePortableSnapshotGraph(snapshot);

/** {@link createPortableSnapshotGraphSource} for a caller that decodes in steps. */
export const createPortableSnapshotGraphSteps =
  (snapshot: PortableSnapshot): (() => Steps<EventGraph>) =>
  () =>
    decodePortableSnapshotGraphSteps(snapshot);

/**
 * Whether restoring `snapshot` must replay its graph to prove its text.
 *
 * Snapshots produced from live replica state in this process, and byte
 * arrays encoded from them, carry a validation proof and skip the replay.
 */
export const portableSnapshotRequiresTextValidation = (
  snapshot: PortableSnapshot,
): boolean => matchingProof(snapshot) === null;

/** Reject a snapshot whose graph does not replay to its recorded text. */
export const assertPortableSnapshotText = (
  replayedText: string,
  snapshotText: string,
): void => {
  if (replayedText !== snapshotText) {
    throw new Error("Invalid portable snapshot: materialized text mismatch");
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
