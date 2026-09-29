import {
  assertPortableSnapshotText,
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
