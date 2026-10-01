import {
  assertPortableSnapshotText,
  authenticatePortableSnapshot,
  decodeAuthenticatedPortableSnapshot,
  decodePortableSnapshot,
  decodePortableSnapshotGraph,
  encodePortableSnapshot,
  type PortableSnapshot,
} from "./portable-snapshot";
import { EgWalkerReplica } from "./replica";

/**
 * EGWP1 bytes for a {@link PortableSnapshot}.
 *
 * Snapshots created from live replica state in this process are encoded as
 * they are. Any other snapshot is proven first: its graph must match the
 * header and replay to its text, through the same sectioned cold replay a
 * restored replica runs.
 */
export class PortableSnapshotCodec {
  encode(snapshot: PortableSnapshot): Uint8Array {
    return encodePortableSnapshot(snapshot, validateUntrustedSnapshot);
  }

  decode(bytes: Uint8Array): PortableSnapshot {
    return decodePortableSnapshot(bytes);
  }

  /**
   * HMAC-SHA-256 tag over EGWP1 bytes, under a key the application holds.
   * Store it with the bytes; {@link decodeAuthenticated} with the same key
   * then restores them without replaying their history.
   *
   * Bytes this codec encoded in this process from a validated snapshot are
   * tagged as they are. Any other bytes are proven first, with the replay
   * {@link encode} runs for an untrusted snapshot, and rejected if their
   * history does not replay to their text, so only proven snapshots get a
   * tag. `key` must be an HMAC CryptoKey for SHA-256 with the `sign` usage,
   * for example from
   * `crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])`.
   */
  authenticate(bytes: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
    return authenticatePortableSnapshot(bytes, key, validateUntrustedSnapshot);
  }

  /**
   * Decode EGWP1 bytes whose {@link authenticate} tag verifies under `key`.
   * The snapshot is trusted: {@link EgWalkerReplica.fromPortableSnapshot}
   * restores it without the replay that proves an untrusted text, so
   * {@link EgWalkerReplica.prepare} only decodes its history.
   *
   * Rejects when the tag does not match, for instance because the bytes
   * changed or the key is different. Such bytes can still be opened as an
   * untrusted snapshot with {@link decode}.
   */
  decodeAuthenticated(
    bytes: Uint8Array,
    tag: Uint8Array,
    key: CryptoKey,
  ): Promise<PortableSnapshot> {
    return decodeAuthenticatedPortableSnapshot(bytes, tag, key);
  }
}

const validateUntrustedSnapshot = (
  snapshot: PortableSnapshot,
): PortableSnapshot => {
  const replica = new EgWalkerReplica(
    "portable-snapshot-validation",
    snapshot.initialText,
    decodePortableSnapshotGraph(snapshot),
    { nextSequenceNumber: snapshot.nextSequenceNumber },
  );
  assertPortableSnapshotText(replica.getText(), snapshot.text);
  return snapshot;
};
