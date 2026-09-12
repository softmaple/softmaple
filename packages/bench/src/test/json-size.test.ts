import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import { jsonByteLength } from "../bench/json-size";

const stringifiedBytes = (value: unknown): number => {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 0 : Buffer.byteLength(encoded, "utf8");
};

describe("jsonByteLength", () => {
  it("matches JSON.stringify byte length across JSON shapes", () => {
    const values: ReadonlyArray<unknown> = [
      null,
      true,
      0,
      -1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "",
      "plain",
      'quotes " and \\ and \n',
      "🙂 combining é ZWJ 👩‍💻",
      [],
      {},
      [1, "two", null, [3, [4]]],
      { a: 1, b: [2, 3], c: { d: "e" } },
      { text: "hello", eventGraph: { events: [], frontier: ["a:0"] } },
      new Date(0),
      { at: new Date(1700000000000) },
    ];

    for (const value of values) {
      expect(jsonByteLength(value)).toBe(stringifiedBytes(value));
    }
  });

  it("mirrors how JSON.stringify drops and nulls unserializable entries", () => {
    const withHoles = {
      kept: 1,
      dropped: undefined,
      alsoDropped: () => undefined,
      list: [1, undefined, 2],
    };

    expect(jsonByteLength(withHoles)).toBe(stringifiedBytes(withHoles));
    expect(jsonByteLength(undefined)).toBe(0);
    expect(jsonByteLength(() => undefined)).toBe(0);
  });

  it("matches on a serialize()-shaped payload with many events", () => {
    const payload = {
      text: "x".repeat(512),
      eventGraph: {
        events: Array.from({ length: 2_000 }, (_, index) => ({
          id: `replica:${index}`,
          parentVersion: index === 0 ? [] : [`replica:${index - 1}`],
          operation: { type: "insert", index, text: "é" },
          timestamp: index,
        })),
        frontier: ["replica:1999"],
        metadata: {},
      },
    };

    expect(jsonByteLength(payload)).toBe(stringifiedBytes(payload));
  });
});
