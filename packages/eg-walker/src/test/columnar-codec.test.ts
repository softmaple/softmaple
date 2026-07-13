import { describe, expect, it, vi } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import lz4 from "lz4js";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { EventGraph } from "../graph/event-graph";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";

describe("ColumnarEventGraphCodec", () => {
  it("round-trips the event graph through the columnar codec", () => {
    const graph = new EventGraph();
    graph.addEvent({
      id: "alice:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Hi" },
      timestamp: 1,
    });
    graph.addEvent({
      id: "alice:1",
      parentVersion: new Set(["alice:0"]),
      operation: { type: OPERATION_TYPE.DELETE, index: 1, length: 1 },
      timestamp: 2,
    });

    const codec = new ColumnarEventGraphCodec();
    const decoded = codec.decode(codec.encode(graph));

    expect(decoded.getTopologicalOrder()).toEqual(graph.getTopologicalOrder());
    expect(decoded.getFrontier()).toEqual(new Set(["alice:1"]));
  });

  it("round-trips the event graph through the binary columnar codec", () => {
    const graph = new EventGraph();
    for (let i = 0; i < 20; i++) {
      graph.addEvent({
        id: `alice:${i}`,
        parentVersion: i === 0 ? new Set() : new Set([`alice:${i - 1}`]),
        operation: { type: OPERATION_TYPE.INSERT, index: i, text: "x" },
        timestamp: 1_778_000_000_000 + i,
      });
    }

    const codec = new ColumnarEventGraphCodec();
    const decoded = codec.decodeBinary(codec.encodeBinary(graph));

    expect(decoded.getTopologicalOrder()).toEqual(graph.getTopologicalOrder());
    expect(
      new EgWalkerEngine().generate(decoded.getTopologicalOrder()).text,
    ).toBe("x".repeat(20));
  });

  it("preserves a leading U+FEFF in the inserted-content column", () => {
    const graph = new EventGraph();
    graph.addEvent({
      id: "bom:0",
      parentVersion: new Set(),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: "\uFEFFcontent",
      },
      timestamp: 0,
    });

    const codec = new ColumnarEventGraphCodec();
    const decoded = codec.decodeBinary(codec.encodeBinary(graph));

    expect(decoded.getEvent("bom:0")?.operation).toEqual({
      type: OPERATION_TYPE.INSERT,
      index: 0,
      text: "\uFEFFcontent",
    });
  });

  it("preserves a single sequence-zero generated ID through columnar codecs", () => {
    const graph = new EventGraph();
    graph.addEvent({
      id: "alice:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 1,
    });

    const codec = new ColumnarEventGraphCodec();
    const decodedText = codec.decode(codec.encode(graph));
    const decodedBinary = codec.decodeBinary(codec.encodeBinary(graph));

    expect(decodedText.getTopologicalOrder().map((event) => event.id)).toEqual([
      "alice:0",
    ]);
    expect(
      decodedBinary.getTopologicalOrder().map((event) => event.id),
    ).toEqual(["alice:0"]);
  });

  it("decodes alternating columnar operation runs in linear run order", () => {
    const graph = new EventGraph();
    for (let i = 0; i < 800; i++) {
      graph.addEvent({
        id: `event:${i}`,
        parentVersion: i === 0 ? new Set() : new Set([`event:${i - 1}`]),
        operation:
          i % 2 === 0
            ? { type: OPERATION_TYPE.INSERT, index: 0, text: "x" }
            : { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
        timestamp: i,
      });
    }

    const codec = new ColumnarEventGraphCodec();
    const encoded = codec.encode(graph);
    const decoded = codec.decode(encoded);

    expect(encoded.operationRuns).toHaveLength(800);
    expect(decoded.getTopologicalOrder()).toEqual(graph.getTopologicalOrder());
  });

  it("rejects malformed binary columnar payloads", () => {
    const codec = new ColumnarEventGraphCodec();

    expect(() => codec.decodeBinary(new Uint8Array())).toThrow(
      "Unexpected end of varint",
    );
    expect(() => codec.decodeBinary(new Uint8Array([1, 0]))).toThrow(
      "Invalid eg-walker columnar graph header",
    );
    expect(() => codec.decodeBinary(new Uint8Array([4, 0x45, 0x47]))).toThrow(
      "Unexpected end of binary eg-walker graph",
    );

    const graph = new EventGraph();
    const valid = codec.encodeBinary(graph);
    const trailing = new Uint8Array(valid.length + 1);
    trailing.set(valid);
    expect(() => codec.decodeBinary(trailing)).toThrow(/trailing bytes/);
  });

  it("rejects a columnar version that is not the graph frontier", () => {
    const graph = new EventGraph();
    graph.addEvent({
      id: "root",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 1,
    });
    const codec = new ColumnarEventGraphCodec();

    expect(() => codec.decode({ ...codec.encode(graph), version: [] })).toThrow(
      /version does not match its frontier/,
    );
  });

  it("covers columnar ID and malformed operation run edge cases", () => {
    const graph = new EventGraph();
    graph.addEvent({
      id: "custom-id",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 1,
    });
    graph.addEvent({
      id: "replica:not-number",
      parentVersion: new Set(["custom-id"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
      timestamp: 2,
    });

    const codec = new ColumnarEventGraphCodec();
    const encoded = codec.encode(graph);

    expect(codec.toSerializedGraph(encoded).events).toHaveLength(2);
    expect(
      codec.decodeBinary(codec.encodeBinary(graph)).getAllEvents(),
    ).toHaveLength(2);
    expect(() =>
      codec.decode({
        ...encoded,
        operationRuns: [],
      }),
    ).toThrow("Missing operation run for event offset 0");
    expect(() =>
      codec.decode({
        ...encoded,
        operationRuns: [
          {
            type: OPERATION_TYPE.INSERT,
            startIndex: 0,
            startEventOffset: 1,
            length: 1,
            textLength: 1,
          },
        ],
      }),
    ).toThrow("Operation run 0 does not cover event offset 0");

    expect(() =>
      codec.decode({
        ...encoded,
        parentOverrides: [{ eventOffset: 1, parents: ["missing"] }],
      }),
    ).toThrow("Missing parent event: missing");

    graph.addEvent({
      id: "replica:2",
      parentVersion: new Set(["replica:not-number"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "C" },
      timestamp: Number.NaN,
    });
    // EGW3 zigzag-delta encodes timestamps so negative values are valid; the
    // varint guard still rejects non-safe integers like NaN/Infinity.
    expect(() => codec.encodeBinary(graph)).toThrow(
      "Cannot encode invalid zigzag varint value NaN",
    );
  });

  it("round-trips a large inserted-content payload through the binary codec", () => {
    // Build distinct, mostly-incompressible blocks so LZ4 cannot dedupe across
    // events. Exercises the BinaryWriter buffer growth that previously
    // overflowed JS arg limits via push-spread of a Uint8Array.
    let prng = 0x9e_37_79_b9 >>> 0;
    const nextChar = (): string => {
      prng = (prng * 1_103_515_245 + 12_345) >>> 0;
      return String.fromCharCode(0x21 + (prng % 94));
    };
    const blocks = Array.from({ length: 32 }, () =>
      Array.from({ length: 4_096 }, nextChar).join(""),
    );

    const graph = new EventGraph();
    let cursor = 0;
    blocks.forEach((block, i) => {
      graph.addEvent({
        id: `bulk:${i}`,
        parentVersion: i === 0 ? new Set() : new Set([`bulk:${i - 1}`]),
        operation: { type: OPERATION_TYPE.INSERT, index: cursor, text: block },
        timestamp: 1_778_000_000_000 + i,
      });
      cursor += block.length;
    });

    const codec = new ColumnarEventGraphCodec();
    const encoded = codec.encodeBinary(graph);
    const decoded = codec.decodeBinary(encoded);
    const text = new EgWalkerEngine().generate(
      decoded.getTopologicalOrder(),
    ).text;
    expect(text).toBe(blocks.join(""));
  });

  it("caps lz4 destination allocation against the declared textLengths sum", () => {
    const graph = new EventGraph();
    graph.addEvent({
      id: "bounded:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "😀" },
      timestamp: 1,
    });

    const codec = new ColumnarEventGraphCodec();
    const encoded = codec.encodeBinary(graph);
    const decompressSpy = vi.spyOn(lz4, "decompress");

    try {
      codec.decodeBinary(encoded);
      // 2 UTF-16 code units * 4 + 64 = 72 bytes maxInsertedBytes.
      expect(decompressSpy).toHaveBeenCalledWith(expect.any(Uint8Array), 72);
    } finally {
      decompressSpy.mockRestore();
    }
  });

  it("rejects payloads whose decompressed content does not match declared textLengths", () => {
    const codec = new ColumnarEventGraphCodec();
    // Real, well-formed payload: one 5-char insert. textLengths sum = 5.
    const realGraph = new EventGraph();
    realGraph.addEvent({
      id: "real:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "hello" },
      timestamp: 1,
    });
    const realPayload = codec.encodeBinary(realGraph);

    // Tampered payload: a 1-char insert (textLengths sum = 1) but the LZ4
    // frame still carries the 5-byte original content. After decompression,
    // insertedContent.length would be 5 even though textLengths declares 1.
    // This is what a decompression-bomb / content-injection payload would
    // produce, and we want the codec to reject it.
    const tamperedGraph = new EventGraph();
    tamperedGraph.addEvent({
      id: "real:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
      timestamp: 1,
    });
    const tampered = codec.encodeBinary(tamperedGraph);

    // Splice the real payload's LZ4 frame into the tampered payload by
    // mocking lz4.decompress to return the larger content while textLengths
    // remains 1. lz4js silently truncates to maxInsertedBytes; the codec's
    // length-equality check is what catches the tampering.
    const decompressSpy = vi
      .spyOn(lz4, "decompress")
      .mockReturnValue(new TextEncoder().encode("hello"));

    try {
      expect(() => codec.decodeBinary(tampered)).toThrow(
        /Decompressed inserted-content size mismatch/,
      );
    } finally {
      decompressSpy.mockRestore();
    }
    // Sanity-check the real payload still round-trips with the spy
    // restored — confirms the tampering was the only thing the test
    // depended on.
    expect(codec.decodeBinary(realPayload).getAllEvents()).toHaveLength(1);
  });

  it("rejects binary payloads whose magic prefix is too short", () => {
    const codec = new ColumnarEventGraphCodec();
    // Length-prefix says 3 bytes of magic, but EGW3 is 4 bytes. Even though
    // the bytes that ARE present match, the length must equal the magic.
    expect(() =>
      codec.decodeBinary(new Uint8Array([3, 0x45, 0x47, 0x57])),
    ).toThrow("Invalid eg-walker columnar graph header");
  });

  it("rejects binary payloads from older incompatible versions (EGW1, EGW2)", () => {
    const codec = new ColumnarEventGraphCodec();
    // 4-byte EGW1 prefix; current decoder expects EGW3.
    const egw1Header = new Uint8Array([4, 0x45, 0x47, 0x57, 0x31]);
    expect(() => codec.decodeBinary(egw1Header)).toThrow(
      "Invalid eg-walker columnar graph header",
    );
    // 4-byte EGW2 prefix; also rejected after the EGW3 layout change.
    const egw2Header = new Uint8Array([4, 0x45, 0x47, 0x57, 0x32]);
    expect(() => codec.decodeBinary(egw2Header)).toThrow(
      "Invalid eg-walker columnar graph header",
    );
  });

  it("survives deep histories without recursion-stack overflow", () => {
    const graph = new EventGraph();
    const total = 25_000;
    for (let i = 0; i < total; i++) {
      graph.addEvent({
        id: `deep:${i}`,
        parentVersion: i === 0 ? new Set() : new Set([`deep:${i - 1}`]),
        operation: { type: OPERATION_TYPE.INSERT, index: i, text: "a" },
        timestamp: i,
      });
    }

    const ordered = graph.getTopologicalOrder();
    expect(ordered).toHaveLength(total);
    expect(graph.expandVersion(graph.getFrontier()).size).toBe(total);

    const reSerialized = EventGraph.deserialize(graph.serialize());
    expect(reSerialized.getAllEvents()).toHaveLength(total);
  });
});
