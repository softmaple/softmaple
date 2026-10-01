// EGW3 is read-only: every encoder writes EGW4, and EGW3 payloads that
// existing snapshots hold still decode. The layout, after the magic:
//
//   - version: frontier event IDs as a string array.
//   - operationRuns: `(type, length)`; `startEventOffset` is the prefix sum
//     of run lengths and `startIndex` is `operationIndexes[startEventOffset]`.
//   - operationIndexes: zigzag-delta varint per event.
//   - operationLengths: varint per event; an insert's is its text length.
//   - insertedContent: LZ4 frame of the UTF-8 inserted text.
//   - parentOverrides: monotonic-delta varint `eventOffset` plus the parent
//     IDs as strings.
//   - idRuns: `(replicaId, startSequence, length * 2 + custom)`.
//   - timestamps: zigzag-delta varint per event.
//   - metadata: JSON string.

import lz4 from "lz4js";

import { OPERATION_TYPE } from "../../constants/operation-types";
import { EventGraph } from "../event-graph";
import { BinaryReader, decodeText, toUint8Array } from "../internals/binary-io";
import { EventIdRunIndex } from "../internals/event-id-run-index";
import { assertWithinEventLimit } from "../internals/event-limit";
import {
  buildPackedEventGraphBaseFromIdRunIndex,
  buildPackedLinearEventGraphBaseFromIdIndex,
} from "./packed-decode";
import { readIdRuns } from "./ids";
import { readOperationRuns } from "./operations";
import { readParentOverrides } from "./parents";
import {
  sameEventIds,
  strictEventIdSet,
  strictMetadata,
} from "./graph-validation";

/**
 * Decode an EGW3 payload from a reader positioned after its magic. A payload
 * with more than `maxEvents` events is rejected before any per-event column
 * is read.
 */
export const decodeEgw3Graph = (
  reader: BinaryReader,
  maxEvents = Number.POSITIVE_INFINITY,
): EventGraph => {
  const version = reader.readStringArray();
  const partialOperationRuns = readOperationRuns(reader);

  // Validate before consuming the per-event columns so the packed decode
  // never sees undefined values from a short column.
  let operationRunsTotal = 0;
  for (const [runIndex, run] of partialOperationRuns.entries()) {
    if (!Number.isSafeInteger(run.length) || run.length <= 0) {
      throw new Error(
        `Operation run ${runIndex} must have positive safe length`,
      );
    }
    operationRunsTotal += run.length;
    if (!Number.isSafeInteger(operationRunsTotal)) {
      throw new Error("Operation runs exceed safe event count");
    }
  }
  assertWithinEventLimit(operationRunsTotal, maxEvents);
  const operationIndexes = reader.readZigZagDeltaPackedUnsignedArray();
  const operationLengths = reader.readVarintPackedUnsignedArray();
  if (operationIndexes.length !== operationRunsTotal) {
    throw new Error(
      `Column length mismatch: operationIndexes has ${operationIndexes.length} entries but operationRuns implies ${operationRunsTotal} events`,
    );
  }
  if (operationLengths.length !== operationRunsTotal) {
    throw new Error(
      `Column length mismatch: operationLengths has ${operationLengths.length} entries but operationRuns implies ${operationRunsTotal} events`,
    );
  }

  let expectedInsertedSize = 0;
  for (const run of partialOperationRuns) {
    if (run.type !== OPERATION_TYPE.INSERT) continue;
    const end = run.startEventOffset + run.length;
    for (let offset = run.startEventOffset; offset < end; offset++) {
      const length = operationLengths[offset]!;
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new Error(`Invalid operation length at event offset ${offset}`);
      }
      expectedInsertedSize += length;
      if (
        !Number.isSafeInteger(expectedInsertedSize) ||
        expectedInsertedSize > 0xffffffff
      ) {
        throw new Error("Inserted content exceeds packed UTF-16 offset range");
      }
    }
  }
  // Memory cap: LZ4 frames declare a per-block ceiling that's typically
  // 4-8 MB regardless of actual payload, so the frame's decompressBound is
  // not a useful bomb signal. Instead, bound the destination allocation
  // (lz4js writes silently past a too-small dst, then truncates), and then
  // verify the decoded string length matches the declared textLengths sum.
  // textLengths are UTF-16 code units; allow up to 4 UTF-8 bytes per unit
  // plus a small constant overhead for the destination buffer.
  const maxInsertedBytes = expectedInsertedSize * 4 + 64;
  const compressed = reader.readBytes(reader.readVarint());
  const decompressed = toUint8Array(
    lz4.decompress(compressed, maxInsertedBytes),
  );
  const insertedContent = decodeText(decompressed);
  if (insertedContent.length !== expectedInsertedSize) {
    throw new Error(
      `Decompressed inserted-content size mismatch (expected ${expectedInsertedSize} UTF-16 code units, got ${insertedContent.length})`,
    );
  }
  const parentOverrides = readParentOverrides(reader);
  const idRuns = readIdRuns(reader);
  const timestamps = reader.readZigZagDeltaPackedIntegerArray();
  const metadata = JSON.parse(reader.readString()) as unknown;
  if (reader.remainingByteLength !== 0) {
    throw new Error("Invalid eg-walker columnar graph: trailing bytes");
  }

  // Cross-check the two independent event-count sources and validate timestamps.
  const expectedEventCount = idRuns.reduce((sum, run) => sum + run.length, 0);
  if (operationRunsTotal !== expectedEventCount) {
    throw new Error(
      `Column length mismatch: operationRuns covers ${operationRunsTotal} events but idRuns implies ${expectedEventCount}`,
    );
  }
  if (timestamps.length !== expectedEventCount) {
    throw new Error(
      `Column length mismatch: timestamps has ${timestamps.length} entries but idRuns implies ${expectedEventCount} events`,
    );
  }

  const expectedFrontier = strictEventIdSet(version, "columnar graph version");
  const idIndex = EventIdRunIndex.fromRuns(idRuns, expectedEventCount).view();
  const packed =
    parentOverrides.length === 0
      ? buildPackedLinearEventGraphBaseFromIdIndex({
          idIndex,
          operationRuns: partialOperationRuns,
          operationIndexes,
          operationLengths,
          insertedContent,
          timestamps,
        })
      : buildPackedEventGraphBaseFromIdRunIndex({
          idIndex,
          operationRuns: partialOperationRuns,
          operationIndexes,
          operationLengths,
          insertedContent,
          parentOverrides,
          timestamps,
        });
  if (!sameEventIds(packed.frontier, expectedFrontier)) {
    throw new Error("Columnar graph version does not match its frontier");
  }
  return EventGraph.fromPackedBase(
    packed.base,
    packed.frontier,
    strictMetadata(metadata),
  );
};
