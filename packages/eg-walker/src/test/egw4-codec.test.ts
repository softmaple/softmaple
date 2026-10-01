import lz4 from "lz4js";
import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { encodeTopologicallyOrderedEventsBinary } from "../graph/columnar-codec/topological-binary-encoder";
import { BinaryWriter } from "../graph/internals/binary-io";
import { crc32 } from "../graph/internals/crc32";
import type { EventGraph } from "../graph/event-graph";
import type { ExternalOperation, GraphEvent } from "../types";

describe("encodeTopologicallyOrderedEventsBinary", () => {
  it("should write typing, backspace and delete-key runs as one span each", () => {
    // Arrange
    const events = [
      event("a:0", [], insert(0, "a"), 100),
      event("a:1", ["a:0"], insert(1, "b"), 101),
      event("a:2", ["a:1"], insert(2, "c"), 102),
      event("a:3", ["a:2"], insert(3, "d"), 103),
      event("a:4", ["a:3"], remove(3, 1), 104),
      event("a:5", ["a:4"], remove(2, 1), 105),
      event("a:6", ["a:5"], remove(0, 1), 106),
      event("a:7", ["a:6"], remove(0, 1), 107),
    ];

    // Act
    const { binary } = encodeTopologicallyOrderedEventsBinary(events);

    // Assert
    expect(hex(binary)).toBe(
      hex(
        withChecksum([
          ...[0x04, 0x45, 0x47, 0x57, 0x34], // magic "EGW4"
          0x08, // 8 events
          ...[0x01, 0x01, 0x61], // strings: "a"
          ...[0x00, 0x10], // ID run: string 0, 8 events from a:0
          0x00, // no parent overrides
          ...[0x10, 0x01], // lengths: 8 times 1
          ...[0x10, 0x00], // typing: 4 inserts from index 0
          ...[0x0a, 0x00], // backspace: 2 deletes ending at the cursor (4)
          ...[0x09, 0x03], // delete key: 2 deletes at cursor - 2 (index 0)
          ...lz4Text("abcd"),
          ...[0x21, 0xc8, 0x01, 0x02], // timestamps: 8 from 100, step 1
          ...[0x02, 0x7b, 0x7d], // metadata "{}"
        ]),
      ),
    );
  });

  it("should write replica IDs once and parents as distances", () => {
    // Arrange
    const events = [
      event("alice:0", [], insert(0, "ab"), 10),
      event("bob:0", [], insert(0, "X"), 11),
      event("alice:1", ["alice:0"], insert(2, "c"), 12),
      event("merge", ["alice:1", "bob:0"], insert(0, "M"), 12),
      event("alice:5", ["merge"], remove(1, 1), 13),
    ];

    // Act
    const { binary } = encodeTopologicallyOrderedEventsBinary(events);

    // Assert
    expect(hex(binary)).toBe(
      hex(
        withChecksum([
          ...[0x04, 0x45, 0x47, 0x57, 0x34], // magic "EGW4"
          0x05, // 5 events
          0x03, // strings: "alice", "bob", "merge"
          ...[0x05, 0x61, 0x6c, 0x69, 0x63, 0x65],
          ...[0x03, 0x62, 0x6f, 0x62],
          ...[0x05, 0x6d, 0x65, 0x72, 0x67, 0x65],
          ...[0x00, 0x02], // alice:0
          ...[0x02, 0x02], // bob:0
          ...[0x00, 0x02], // alice:1, after alice's previous run
          0x05, // custom ID "merge"
          ...[0x00, 0x03, 0x05], // alice:5, jumped to sequence 5
          0x03, // 3 parent overrides
          0x04, // bob:0 at offset 1 has no parent
          ...[0x01, 0x02], // alice:1 at offset 2: alice:0, 2 events back
          ...[0x02, 0x01, 0x02], // merge at offset 3: alice:1 and bob:0
          ...[0x03, 0x02, 0x08, 0x01], // lengths: literal 2, then 4 times 1
          ...[0x04, 0x00], // insert "ab" at cursor 0
          ...[0x04, 0x03], // insert "X" at cursor - 2
          ...[0x04, 0x02], // insert "c" at cursor + 1
          ...[0x04, 0x05], // insert "M" at cursor - 3
          ...[0x05, 0x00], // delete at the cursor
          ...lz4Text("abXcM"),
          ...[0x0d, 0x14, 0x02], // timestamps 10, 11, 12: step 1
          ...[0x08, 0x00], // timestamps 12, 13: same step
          ...[0x02, 0x7b, 0x7d], // metadata "{}"
        ]),
      ),
    );
  });

  it("should reject an operation that ends beyond the safe integer range", () => {
    // Arrange
    const events = [event("a:0", [], remove(Number.MAX_SAFE_INTEGER, 1), 0)];

    // Act
    const encode = () => encodeTopologicallyOrderedEventsBinary(events);

    // Assert
    expect(encode).toThrow(
      "Event a:0 operation ends beyond the safe integer range",
    );
  });
});

describe("ColumnarEventGraphCodec.decodeBinary", () => {
  it("should decode each event of typing, backspace and delete-key spans", () => {
    // Arrange
    const events = [
      event("a:0", [], insert(0, "h"), 1),
      event("a:1", ["a:0"], insert(1, "🙂"), 2),
      event("a:2", ["a:1"], insert(3, "i"), 3),
      event("a:3", ["a:2"], remove(3, 1), 4),
      event("a:4", ["a:3"], remove(1, 2), 5),
      event("a:5", ["a:4"], remove(0, 1), 6),
      event("a:6", ["a:5"], remove(0, 0), 7),
    ];
    const { binary } = encodeTopologicallyOrderedEventsBinary(events);

    // Act
    const decoded = new ColumnarEventGraphCodec().decodeBinary(binary);

    // Assert
    expect(eventsOf(decoded)).toEqual(events);
  });

  it("should keep indexes, lengths and timestamps beyond 32 bits", () => {
    // Arrange
    const events = [
      event("a:0", [], insert(2 ** 33, "x"), -(2 ** 40)),
      event("a:1", ["a:0"], remove(2 ** 34, 2 ** 35), 2 ** 45),
      event("a:2", ["a:1"], insert(0, "y"), 0),
    ];
    const { binary } = encodeTopologicallyOrderedEventsBinary(events);

    // Act
    const decoded = new ColumnarEventGraphCodec().decodeBinary(binary);

    // Assert
    expect(eventsOf(decoded)).toEqual(events);
  });

  it("should cap the LZ4 destination by what the frame can expand to", () => {
    // Arrange
    const content = lz4Text("x");
    const bytes = payload({
      count: [0x01],
      idRuns: [0x00, 0x02],
      lengths: [0x02, ...varint(2 ** 31)],
      operations: [0x04, 0x00],
      content,
      timestamps: [0x04, 0x00],
    });
    const decompress = vi.spyOn(lz4, "decompress");

    // Act
    const decode = () => new ColumnarEventGraphCodec().decodeBinary(bytes);

    // Assert
    try {
      expect(decode).toThrow(/inserted-content size mismatch/);
      const frameLength = content.length - 1;
      expect(decompress).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        frameLength * 256 + 64,
      );
    } finally {
      decompress.mockRestore();
    }
  });

  it("should reject a payload whose checksum does not match", () => {
    // Arrange
    const valid = payload({});
    const corrupt = valid.slice();
    corrupt[6] = corrupt[6]! ^ 0x01;

    // Act
    const decode = () => new ColumnarEventGraphCodec().decodeBinary(corrupt);

    // Assert
    expect(decode).toThrow(/checksum mismatch/);
  });

  it("should reject every truncation of a payload", () => {
    // Arrange
    const valid = payload({});

    // Act
    const truncations = Array.from({ length: valid.length }, (_, length) =>
      valid.subarray(0, length),
    );

    // Assert
    for (const truncated of truncations) {
      expect(() =>
        new ColumnarEventGraphCodec().decodeBinary(truncated),
      ).toThrow();
    }
  });

  it.each<{
    readonly name: string;
    readonly sections: PayloadSections;
    readonly error: RegExp;
  }>([
    {
      name: "an event count beyond 32 bits",
      sections: { count: varint(2 ** 32) },
      error: /exceeds the packed range/,
    },
    {
      name: "more strings than bytes",
      sections: { strings: [0x7f] },
      error: /Unexpected end/,
    },
    {
      name: "an empty string",
      sections: { strings: [0x01, 0x00] },
      error: /ID string 0 is empty/,
    },
    {
      name: "a repeated string",
      sections: { strings: [0x02, 0x01, 0x61, 0x01, 0x61] },
      error: /ID string 1 repeats a/,
    },
    {
      name: "an ID run naming a missing string",
      sections: { idRuns: [0x02, 0x06] },
      error: /refers to missing string 1/,
    },
    {
      name: "a custom ID that parses as replica:sequence",
      sections: {
        strings: [0x01, 0x03, 0x61, 0x3a, 0x31],
        idRuns: [0x01, 0x01, 0x01],
      },
      error: /Custom event ID a:1 must not be canonical/,
    },
    {
      name: "an empty ID run",
      sections: { idRuns: [0x00, 0x00] },
      error: /ID run 0 has invalid length 0/,
    },
    {
      name: "ID runs beyond the event count",
      sections: { idRuns: [0x00, 0x08] },
      error: /ID run 0 has invalid length 4/,
    },
    {
      name: "a sequence beyond the safe integer range",
      sections: { idRuns: [0x00, 0x07, ...varint(Number.MAX_SAFE_INTEGER)] },
      error: /exceeds the safe sequence range/,
    },
    {
      name: "more overrides than events",
      sections: { parents: [0x04] },
      error: /Invalid parent override count 4/,
    },
    {
      name: "an override beyond the last event",
      sections: { parents: [0x01, 0x0c] },
      error: /Invalid parent override offset 3/,
    },
    {
      name: "more parents than earlier events",
      sections: { parents: [0x01, 0x07, 0x00] },
      error: /Event at offset 1 lists 3 parents/,
    },
    {
      name: "a parent at distance zero",
      sections: { parents: [0x01, 0x05, 0x00] },
      error: /Event at offset 1 has a parent that is not before it/,
    },
    {
      name: "a parent before the first event",
      sections: { parents: [0x01, 0x05, 0x02] },
      error: /Event at offset 1 has a parent that is not before it/,
    },
    {
      name: "a repeated parent",
      sections: { parents: [0x01, 0x0a, 0x02, 0x02] },
      error: /Event at offset 2 repeats a parent/,
    },
    {
      name: "an override naming the previous event",
      sections: { parents: [0x01, 0x05, 0x01] },
      error: /Redundant parent override at offset 1/,
    },
    {
      name: "an override giving the first event no parents",
      sections: { parents: [0x01, 0x00] },
      error: /Redundant parent override at offset 0/,
    },
    {
      name: "an empty length run",
      sections: { lengths: [0x00] },
      error: /Length run at event offset 0 has invalid length 0/,
    },
    {
      name: "length runs beyond the event count",
      sections: { lengths: [0x08, 0x01] },
      error: /Length run at event offset 0 has invalid length 4/,
    },
    {
      name: "an unknown span kind",
      sections: { operations: [0x0f, 0x00] },
      error: /Unknown operation span kind 3/,
    },
    {
      name: "spans beyond the event count",
      sections: { operations: [0x10, 0x00] },
      error: /Operation span at event offset 0 has invalid length 4/,
    },
    {
      name: "a span anchored before the document",
      sections: { operations: [0x0c, 0x01] },
      error: /Invalid operation index at event offset 0/,
    },
    {
      name: "a backspace span past the document start",
      sections: { operations: [0x0e, 0x04] },
      error: /Invalid operation index at event offset 2/,
    },
    {
      name: "content shorter than the inserts",
      sections: { content: lz4Text("xy") },
      error: /inserted-content size mismatch/,
    },
    {
      name: "content that is not UTF-8",
      sections: { content: lz4Bytes([0xff, 0xfe, 0xfd]) },
      error: /Invalid UTF-8/,
    },
    {
      name: "an insert splitting a surrogate pair",
      sections: { content: lz4Text("x🙂") },
      error: /Insert text at event offset 1 is not well-formed UTF-16/,
    },
    {
      name: "an unknown timestamp segment mode",
      sections: { timestamps: [0x0f, 0x00] },
      error: /Unknown timestamp segment mode 3/,
    },
    {
      name: "timestamp segments beyond the event count",
      sections: { timestamps: [0x10, 0x00] },
      error: /Timestamp segment at event offset 0 has invalid length 4/,
    },
    {
      name: "a timestamp beyond the safe integer range",
      sections: {
        timestamps: [
          0x0e,
          ...varint(2 ** 53 - 2), // zigzag of 2^52 - 1
          ...varint(2 ** 53 - 2),
          ...varint(4), // zigzag of 2
        ],
      },
      error: /Invalid timestamp at event offset 2/,
    },
    {
      name: "metadata that is not JSON",
      sections: { metadata: [0x01, 0x7b] },
      error: /Invalid eg-walker columnar graph metadata/,
    },
    {
      name: "metadata that is not an object",
      sections: { metadata: [0x02, 0x5b, 0x5d] },
      error: /metadata must be an object/,
    },
    {
      name: "bytes after the metadata",
      sections: { metadata: [0x02, 0x7b, 0x7d, 0x00] },
      error: /trailing bytes/,
    },
  ])("should reject $name", ({ sections, error }) => {
    // Arrange
    const bytes = payload(sections);

    // Act
    const decode = () => new ColumnarEventGraphCodec().decodeBinary(bytes);

    // Assert
    expect(decode).toThrow(error);
  });
});

// Helpers

const insert = (index: number, text: string): ExternalOperation => ({
  type: OPERATION_TYPE.INSERT,
  index,
  text,
});

const remove = (index: number, length: number): ExternalOperation => ({
  type: OPERATION_TYPE.DELETE,
  index,
  length,
});

const event = (
  id: string,
  parents: ReadonlyArray<string>,
  operation: ExternalOperation,
  timestamp: number,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation,
  timestamp,
});

/** Events in their topological order, as `GraphEvent`s. */
const eventsOf = (graph: EventGraph): GraphEvent[] =>
  graph.getTopologicalOrder().map((decoded) => ({
    id: decoded.id,
    parentVersion: new Set(decoded.parentVersion),
    operation: decoded.operation,
    timestamp: decoded.timestamp,
  }));

const hex = (bytes: ArrayLike<number>): string =>
  Buffer.from(Array.from(bytes)).toString("hex");

const varint = (value: number): number[] => {
  const writer = new BinaryWriter();
  writer.writeVarint(value);
  return Array.from(writer.toUint8Array());
};

/** Length-prefixed LZ4 frame of `bytes`, as the content section holds it. */
const lz4Bytes = (bytes: ReadonlyArray<number>): number[] => {
  const writer = new BinaryWriter();
  writer.writeBytes(lz4.compress(new Uint8Array(bytes)));
  return Array.from(writer.toUint8Array());
};

const lz4Text = (text: string): number[] =>
  lz4Bytes(Array.from(new TextEncoder().encode(text)));

/** `bytes` followed by their CRC-32, little-endian. */
const withChecksum = (bytes: ReadonlyArray<number>): Uint8Array => {
  const writer = new BinaryWriter();
  writer.writeRaw(new Uint8Array(bytes));
  writer.writeUint32LE(crc32(writer.view()));
  return writer.toUint8Array();
};

interface PayloadSections {
  readonly count?: ReadonlyArray<number>;
  readonly strings?: ReadonlyArray<number>;
  readonly idRuns?: ReadonlyArray<number>;
  readonly parents?: ReadonlyArray<number>;
  readonly lengths?: ReadonlyArray<number>;
  readonly operations?: ReadonlyArray<number>;
  readonly content?: ReadonlyArray<number>;
  readonly timestamps?: ReadonlyArray<number>;
  readonly metadata?: ReadonlyArray<number>;
}

/**
 * An EGW4 payload with a valid checksum. Sections not given describe a:0,
 * a:1 and a:2 typing "xyz" at timestamp 0.
 */
const payload = (sections: PayloadSections): Uint8Array =>
  withChecksum([
    ...[0x04, 0x45, 0x47, 0x57, 0x34],
    ...(sections.count ?? [0x03]),
    ...(sections.strings ?? [0x01, 0x01, 0x61]),
    ...(sections.idRuns ?? [0x00, 0x06]),
    ...(sections.parents ?? [0x00]),
    ...(sections.lengths ?? [0x06, 0x01]),
    ...(sections.operations ?? [0x0c, 0x00]),
    ...(sections.content ?? lz4Text("xyz")),
    ...(sections.timestamps ?? [0x0c, 0x00]),
    ...(sections.metadata ?? [0x02, 0x7b, 0x7d]),
  ]);
