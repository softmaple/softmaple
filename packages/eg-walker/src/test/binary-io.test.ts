import { describe, expect, it } from "vitest";

import { BinaryReader, BinaryWriter } from "../graph/internals/binary-io";

describe("BinaryReader.readVarint hardening", () => {
  it("rejects a payload longer than the MAX_BYTES cap", () => {
    // Eight continuation-only bytes (0x80 = continuation set, zero data
    // payload) keep the accumulated value at 0 through every iteration, so
    // the per-byte `value > MAX_SAFE_INTEGER` guard never fires. The loop
    // exits via its `bytesRead < MAX_BYTES` condition instead, exercising
    // the length-cap throw distinctly from the value-overflow path below.
    const lengthCapped = new Uint8Array(8).fill(0x80);
    expect(() => new BinaryReader(lengthCapped).readVarint()).toThrow(
      /maximum encoded length/,
    );
  });

  it("rejects a varint whose decoded value exceeds Number.MAX_SAFE_INTEGER", () => {
    // Seven 0xff bytes followed by a terminating byte that pushes the value
    // past 2^53 - 1. Within MAX_BYTES, but the per-byte safe-integer guard
    // should fire before the loop returns a corrupted double.
    const overflowing = new Uint8Array([
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f,
    ]);
    expect(() => new BinaryReader(overflowing).readVarint()).toThrow(
      /MAX_SAFE_INTEGER/,
    );
  });

  it("rejects a varint that ends mid-stream", () => {
    // Continuation bit set on the final byte means more bytes were expected
    // but the buffer is exhausted; this is a distinct failure from overlong.
    const truncated = new Uint8Array([0xff, 0xff]);
    expect(() => new BinaryReader(truncated).readVarint()).toThrow(
      /Unexpected end of varint/,
    );
  });

  it("still round-trips the safe-integer ceiling", () => {
    const writer = new BinaryWriter();
    writer.writeVarint(Number.MAX_SAFE_INTEGER);
    const bytes = writer.toUint8Array();
    expect(new BinaryReader(bytes).readVarint()).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("round-trips representative values at each encoding-length boundary", () => {
    const cases: ReadonlyArray<{ label: string; value: number }> = [
      { label: "zero", value: 0 },
      { label: "single-byte max (127)", value: 127 },
      { label: "two-byte min (128)", value: 128 },
      { label: "two-byte max (16383)", value: 16383 },
      { label: "three-byte min (16384)", value: 16384 },
      { label: "five-byte (2^32)", value: 2 ** 32 },
    ];
    for (const { label, value } of cases) {
      const writer = new BinaryWriter();
      writer.writeVarint(value);
      expect(new BinaryReader(writer.toUint8Array()).readVarint(), label).toBe(
        value,
      );
    }
  });

  it("rejects impossible Uint32 array lengths before allocating", () => {
    const lengthThreeWithOnePayloadByte = new Uint8Array([3, 0]);

    expect(() =>
      new BinaryReader(lengthThreeWithOnePayloadByte).readVarintUint32Array(),
    ).toThrow(/Unexpected end of varint array/);
  });

  it("rejects varint Uint32 array values that would truncate", () => {
    const writer = new BinaryWriter();
    writer.writeVarint(1);
    writer.writeVarint(2 ** 32);

    expect(() =>
      new BinaryReader(writer.toUint8Array()).readVarintUint32Array(),
    ).toThrow(/Uint32 range/);
  });
});
