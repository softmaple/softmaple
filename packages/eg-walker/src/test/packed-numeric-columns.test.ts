import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { buildPackedEventGraphBase } from "../graph/columnar-codec/packed-decode";
import { BinaryReader, BinaryWriter } from "../graph/internals/binary-io";
import type { PackedEventGraphBase } from "../graph/internals/packed-event-graph-base";
import {
  LinearEventBatch,
  PackedLinearChain,
} from "../graph/internals/packed-linear-chain";
import type { ExternalOperation, Version } from "../types";

const linearBatch = (
  parents: Version,
  events: ReadonlyArray<
    readonly [id: string, operation: ExternalOperation, timestamp: number]
  >,
): LinearEventBatch => {
  const batch = new LinearEventBatch(parents);
  for (const [id, operation, timestamp] of events) {
    if (operation.type === OPERATION_TYPE.INSERT) {
      batch.appendInsert(id, operation.index, operation.text, timestamp);
    } else {
      batch.appendDelete(id, operation.index, operation.length, timestamp);
    }
  }
  return batch.finish();
};

interface PackedNumericStorage {
  readonly operationIndexes: Uint32Array | Float64Array;
  readonly operationLengths: Uint32Array | Float64Array;
  readonly timestamps: Int32Array | Uint32Array | Float64Array;
}

const numericStorage = (base: PackedEventGraphBase): PackedNumericStorage => {
  // Deferred columns load on first read.
  base.operationIndexAt(0);
  return (base as unknown as { operationColumns: PackedNumericStorage })
    .operationColumns;
};

describe("packed numeric columns", () => {
  it("retains common operation columns in 32-bit storage", () => {
    const { base } = buildPackedEventGraphBase({
      ids: ["a:0", "a:1"],
      operationRuns: [
        { type: OPERATION_TYPE.INSERT, startEventOffset: 0, length: 2 },
      ],
      operationIndexes: new Float64Array([0, 1]),
      operationLengths: new Float64Array([1, 1]),
      insertedContent: "ab",
      parentOverrides: [],
      timestamps: new Float64Array([-1, 0x7fff_ffff]),
    });
    const storage = numericStorage(base);

    expect(storage.operationIndexes).toBeInstanceOf(Uint32Array);
    expect(storage.operationLengths).toBeInstanceOf(Uint32Array);
    expect(storage.timestamps).toBeInstanceOf(Int32Array);
    expect(base.operationAt(1)).toEqual({
      type: OPERATION_TYPE.INSERT,
      index: 1,
      text: "b",
    });
    expect(base.timestampAt(0)).toBe(-1);
  });

  it("uses Uint32 timestamps when the signed high bit is required", () => {
    const { base } = buildPackedEventGraphBase({
      ids: ["a:0"],
      operationRuns: [
        { type: OPERATION_TYPE.DELETE, startEventOffset: 0, length: 1 },
      ],
      operationIndexes: new Float64Array([0]),
      operationLengths: new Float64Array([0]),
      insertedContent: "",
      parentOverrides: [],
      timestamps: new Float64Array([0xffff_ffff]),
    });

    expect(numericStorage(base).timestamps).toBeInstanceOf(Uint32Array);
    expect(base.timestampAt(0)).toBe(0xffff_ffff);
  });

  it("keeps wide safe integers in Float64 storage without changing values", () => {
    const wideIndex = 0x1_0000_0000;
    const wideLength = Number.MAX_SAFE_INTEGER;
    const wideNegativeTimestamp = -0x8000_0001;
    const { base } = buildPackedEventGraphBase({
      ids: ["a:0"],
      operationRuns: [
        { type: OPERATION_TYPE.DELETE, startEventOffset: 0, length: 1 },
      ],
      operationIndexes: new Float64Array([wideIndex]),
      operationLengths: new Float64Array([wideLength]),
      insertedContent: "",
      parentOverrides: [],
      timestamps: new Float64Array([wideNegativeTimestamp]),
    });
    const storage = numericStorage(base);

    expect(storage.operationIndexes).toBeInstanceOf(Float64Array);
    expect(storage.operationLengths).toBeInstanceOf(Float64Array);
    expect(storage.timestamps).toBeInstanceOf(Float64Array);
    expect(base.operationAt(0)).toEqual({
      type: OPERATION_TYPE.DELETE,
      index: wideIndex,
      length: wideLength,
    });
    expect(base.timestampAt(0)).toBe(wideNegativeTimestamp);
  });

  it("promotes adaptive binary columns without truncating earlier values", () => {
    const unsignedWriter = new BinaryWriter();
    unsignedWriter.writeZigZagDeltaArray([0, 0x1_0000_0000]);
    const unsigned = new BinaryReader(
      unsignedWriter.toUint8Array(),
    ).readZigZagDeltaPackedUnsignedArray();

    const signedWriter = new BinaryWriter();
    signedWriter.writeZigZagDeltaArray([-1, 0x8000_0000]);
    const signed = new BinaryReader(
      signedWriter.toUint8Array(),
    ).readZigZagDeltaPackedIntegerArray();

    expect(unsigned).toBeInstanceOf(Float64Array);
    expect(Array.from(unsigned)).toEqual([0, 0x1_0000_0000]);
    expect(signed).toBeInstanceOf(Float64Array);
    expect(Array.from(signed)).toEqual([-1, 0x8000_0000]);
  });

  it("promotes a plain varint column only when a wide value is encountered", () => {
    const writer = new BinaryWriter();
    writer.writeVarintArray([7, 0x1_0000_0000]);

    const values = new BinaryReader(
      writer.toUint8Array(),
    ).readVarintPackedUnsignedArray();

    expect(values).toBeInstanceOf(Float64Array);
    expect(Array.from(values)).toEqual([7, 0x1_0000_0000]);
  });

  it("promotes a signed delta column through Uint32 before Float64", () => {
    const writer = new BinaryWriter();
    writer.writeZigZagDeltaArray([0x8000_0000, -1]);

    const values = new BinaryReader(
      writer.toUint8Array(),
    ).readZigZagDeltaPackedIntegerArray();

    expect(values).toBeInstanceOf(Float64Array);
    expect(Array.from(values)).toEqual([0x8000_0000, -1]);
  });

  it("widens packed chain columns without truncating earlier batches", () => {
    const wide = 0x1_0000_0000;
    const chain = new PackedLinearChain();
    chain.append(
      linearBatch(new Set(), [
        ["alice:0", { type: OPERATION_TYPE.INSERT, index: 0, text: "a" }, 7],
      ]),
    );
    const base = chain.append(
      linearBatch(new Set(["alice:0"]), [
        [
          "alice:1",
          { type: OPERATION_TYPE.INSERT, index: wide, text: "b" },
          0x8000_0000,
        ],
        [
          "alice:2",
          { type: OPERATION_TYPE.DELETE, index: 0, length: wide },
          -1,
        ],
      ]),
    );
    const storage = numericStorage(base);

    expect(storage.operationIndexes).toBeInstanceOf(Float64Array);
    expect(storage.operationLengths).toBeInstanceOf(Float64Array);
    expect(storage.timestamps).toBeInstanceOf(Float64Array);
    expect(base.operationAt(0)).toEqual({
      type: OPERATION_TYPE.INSERT,
      index: 0,
      text: "a",
    });
    expect(base.operationAt(1)).toEqual({
      type: OPERATION_TYPE.INSERT,
      index: wide,
      text: "b",
    });
    expect(base.operationAt(2)).toEqual({
      type: OPERATION_TYPE.DELETE,
      index: 0,
      length: wide,
    });
    expect([0, 1, 2].map((offset) => base.timestampAt(offset))).toEqual([
      7, 0x8000_0000, -1,
    ]);
  });

  it("keeps narrow packed chain columns in 32-bit storage", () => {
    const chain = new PackedLinearChain();
    const base = chain.append(
      linearBatch(new Set(), [
        [
          "alice:0",
          { type: OPERATION_TYPE.INSERT, index: 0, text: "ab" },
          0x8000_0000,
        ],
        ["alice:1", { type: OPERATION_TYPE.DELETE, index: 1, length: 1 }, 3],
      ]),
    );
    const storage = numericStorage(base);

    expect(storage.operationIndexes).toBeInstanceOf(Uint32Array);
    expect(storage.operationLengths).toBeInstanceOf(Uint32Array);
    expect(storage.timestamps).toBeInstanceOf(Uint32Array);
  });
});
