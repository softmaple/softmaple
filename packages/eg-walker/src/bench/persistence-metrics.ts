import { performance } from "node:perf_hooks";

import { NativeSnapshotCodec } from "../core/native-snapshot";
import { PortableSnapshotCodec } from "../core/portable-snapshot";
import { EgWalkerReplica } from "../core/replica";

export interface PersistenceMetrics {
  readonly portableSnapshotEncodeMs: number;
  readonly portableSnapshotDecodeMs: number;
  readonly portableSnapshotRestoreMs: number;
  readonly portableSnapshotMaterializeMs: number;
  readonly portableSnapshotBytes: number;
  readonly nativeSnapshotEncodeMs: number;
  readonly nativeSnapshotDecodeMs: number;
  readonly nativeSnapshotRestoreMs: number;
  readonly nativeSnapshotBytes: number;
  readonly nativeSnapshotFullReplays: number;
  readonly nativeSnapshotPartialReplays: number;
  readonly nativeSnapshotIncrementalApplies: number;
}

export const measurePersistenceMetrics = (
  replica: EgWalkerReplica,
  expectedText: string,
  label: string,
): PersistenceMetrics => {
  const expectedEventCount = replica.exportEventGraph().length;
  const portableCodec = new PortableSnapshotCodec();
  const portableEncodeStartedAt = performance.now();
  const portableBinary = portableCodec.encode(replica.createPortableSnapshot());
  const portableEncodedAt = performance.now();
  // Model bytes that crossed a persistence boundary. The codec deliberately
  // trusts the exact Uint8Array it just encoded, but that identity cannot
  // survive a file write, network transfer, or structured clone.
  const persistedPortableBinary = portableBinary.slice();
  const portableDecodeStartedAt = performance.now();
  const decodedPortable = portableCodec.decode(persistedPortableBinary);
  const portableDecodedAt = performance.now();
  const portableReplica = EgWalkerReplica.fromPortableSnapshot(
    decodedPortable,
    `paper-portable-load:${label}`,
  );
  const portableRestoredAt = performance.now();
  portableReplica.applyRemoteEvents([]);
  const portableMaterializedAt = performance.now();
  if (
    portableReplica.getText() !== expectedText ||
    portableReplica.exportEventGraph().length !== expectedEventCount
  ) {
    throw new Error(`${label}: portable snapshot load mismatch`);
  }

  const nativeCodec = new NativeSnapshotCodec();
  const nativeEncodeStartedAt = performance.now();
  const nativeBinary = nativeCodec.encode(replica.createNativeSnapshot());
  const nativeEncodedAt = performance.now();
  const decodedNative = nativeCodec.decode(nativeBinary);
  const nativeDecodedAt = performance.now();
  const nativeReplica = EgWalkerReplica.fromNativeSnapshot(
    decodedNative,
    `paper-native-snapshot-load:${label}`,
  );
  const nativeRestoredAt = performance.now();
  if (nativeReplica.getText() !== expectedText) {
    throw new Error(`${label}: native snapshot load mismatch`);
  }
  const nativeStats = nativeReplica.getReplayStats();
  if (nativeStats.fullReplays !== 0) {
    throw new Error(
      `${label}: native snapshot restore unexpectedly performed ${nativeStats.fullReplays} full replay(s)`,
    );
  }

  return {
    portableSnapshotEncodeMs: portableEncodedAt - portableEncodeStartedAt,
    portableSnapshotDecodeMs: portableDecodedAt - portableDecodeStartedAt,
    portableSnapshotRestoreMs: portableRestoredAt - portableDecodedAt,
    portableSnapshotMaterializeMs: portableMaterializedAt - portableRestoredAt,
    portableSnapshotBytes: portableBinary.byteLength,
    nativeSnapshotEncodeMs: nativeEncodedAt - nativeEncodeStartedAt,
    nativeSnapshotDecodeMs: nativeDecodedAt - nativeEncodedAt,
    nativeSnapshotRestoreMs: nativeRestoredAt - nativeDecodedAt,
    nativeSnapshotBytes: nativeBinary.byteLength,
    nativeSnapshotFullReplays: nativeStats.fullReplays,
    nativeSnapshotPartialReplays: nativeStats.partialReplays,
    nativeSnapshotIncrementalApplies: nativeStats.incrementalApplies,
  };
};
