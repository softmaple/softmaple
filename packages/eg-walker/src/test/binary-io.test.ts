import { describe, expect, it } from "vitest";

import { BinaryReader, BinaryWriter } from "../graph/internals/binary-io";

describe("BinaryReader.readVarint hardening", () => {
  it("rejects an overlong varint (more bytes than a safe-integer needs)", () => {
    // Nine continuation bytes — never legal: a Number.MAX_SAFE_INTEGER value
    // fits in 8 bytes (7 continuation + 1 terminating). The decoder should
    // bail before reading past the cap rather than spinning over the input.
    const overlong = new Uint8Array(9).fill(0xff);
    expect(() => new BinaryReader(overlong).readVarint()).toThrow(
      /maximum encoded length|MAX_SAFE_INTEGER/,
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

  it("round-trips small varints with no overhead", () => {
    for (const value of [0, 1, 127, 128, 16383, 16384, 2 ** 32]) {
      const writer = new BinaryWriter();
      writer.writeVarint(value);
      expect(new BinaryReader(writer.toUint8Array()).readVarint()).toBe(value);
    }
  });
});
