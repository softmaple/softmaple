/**
 * Build the portable snapshot opened by the snapshot first-edit lanes.
 *
 * Fixture work is never timed and always uses this checkout's eg-walker, so a
 * base and a head build open exactly the same bytes.
 */
import {
  EgWalkerReplica,
  PORTABLE_SNAPSHOT_FORMAT_VERSION,
  PortableSnapshotCodec,
  type GraphEvent,
  type PortableSnapshot,
} from "@softmaple/eg-walker";
import {
  ColumnarEventGraphCodec,
  encodeTopologicallyOrderedEventsBinary,
} from "@softmaple/eg-walker/internal";

import {
  sha256Hex,
  type SnapshotFirstEditManifest,
} from "./snapshot-first-edit";

export interface SnapshotFirstEditFixture {
  readonly bytes: Uint8Array;
  readonly manifest: SnapshotFirstEditManifest;
  readonly text: string;
}

/**
 * Encode `events` in their given causal order as the snapshot's graph.
 * The paper traces arrive in editing order, so `depth` counts events back
 * from the end of the recorded history.
 */
export const buildSnapshotFirstEditFixture = (
  label: string,
  events: ReadonlyArray<GraphEvent>,
  depths: ReadonlyArray<number>,
): SnapshotFirstEditFixture => {
  const encoded = encodeTopologicallyOrderedEventsBinary(events);
  const graph = new ColumnarEventGraphCodec().decodeBinary(encoded.binary);
  const text = new EgWalkerReplica(`${label}:fixture`, "", graph).getText();
  const snapshot: PortableSnapshot = {
    formatVersion: PORTABLE_SNAPSHOT_FORMAT_VERSION,
    text,
    initialText: "",
    currentVersion: encoded.frontier,
    eventCount: events.length,
    nextSequenceNumber: 0,
    eventGraph: encoded.binary,
  };
  // Encoding an untrusted snapshot validates its text against the graph.
  const bytes = new PortableSnapshotCodec().encode(snapshot).slice();

  const ancestorsByDepth: Record<string, string> = {};
  for (const depth of depths) {
    const event = events[events.length - 1 - depth];
    if (event === undefined) {
      throw new Error(
        `${label}: depth ${depth} exceeds the ${events.length}-event history`,
      );
    }
    ancestorsByDepth[String(depth)] = event.id;
  }

  return {
    bytes,
    text,
    manifest: {
      label,
      eventCount: events.length,
      frontier: [...encoded.frontier],
      textLength: text.length,
      textSha256: sha256Hex(text),
      snapshotBytes: bytes.byteLength,
      ancestorsByDepth,
    },
  };
};
