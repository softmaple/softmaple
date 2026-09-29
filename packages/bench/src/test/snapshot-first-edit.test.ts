import { describe, expect, it } from "vitest";

import {
  EgWalkerReplica,
  OPERATION_TYPE,
  PortableSnapshotCodec,
  type EventId,
  type GraphEvent,
} from "@softmaple/eg-walker";
import { ColumnarEventGraphCodec } from "@softmaple/eg-walker/internal";

import {
  assertEditedText,
  FIRST_EDIT_MARKER,
  measureSnapshotFirstEdit,
  parseSnapshotEditKind,
  SECOND_EDIT_MARKER,
} from "../bench/snapshot-first-edit";
import { buildSnapshotFirstEditFixture } from "../bench/snapshot-first-edit-fixture";

const api = { EgWalkerReplica, PortableSnapshotCodec, ColumnarEventGraphCodec };

/** Two authors typing concurrently after a shared root, then one merge. */
const history = (): GraphEvent[] => {
  const events: GraphEvent[] = [
    {
      id: "root:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "|" },
      timestamp: 0,
    },
  ];
  for (const [replicaId, index] of [
    ["alice", 0],
    ["bob", 1],
  ] as const) {
    let parent: EventId = "root:0";
    for (let sequence = 0; sequence < 20; sequence++) {
      const id = `${replicaId}:${sequence}`;
      events.push({
        id,
        parentVersion: new Set([parent]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: index + sequence,
          text: replicaId[0]!,
        },
        timestamp: events.length,
      });
      parent = id;
    }
  }
  events.push({
    id: "carol:0",
    parentVersion: new Set(["alice:19", "bob:19"]),
    operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
    timestamp: events.length,
  });
  return events;
};

describe("snapshot first-edit lanes", () => {
  const fixture = buildSnapshotFirstEditFixture("small", history(), [0, 12]);

  it("prepares an untrusted snapshot of the given causal order", () => {
    const decoded = new PortableSnapshotCodec().decode(fixture.bytes.slice());

    expect(decoded.text).toBe(fixture.text);
    expect(fixture.manifest).toMatchObject({
      label: "small",
      eventCount: 42,
      frontier: ["carol:0"],
      textLength: fixture.text.length,
      ancestorsByDepth: { "0": "carol:0", "12": "bob:8" },
    });
    expect(() =>
      buildSnapshotFirstEditFixture("small", history(), [42]),
    ).toThrow(/depth 42 exceeds/);
  });

  it.each([
    "local",
    "remote",
    "concurrent-0",
    "concurrent-12",
  ])("times and validates the %s lane", (kind) => {
    const result = measureSnapshotFirstEdit(
      api,
      fixture.bytes,
      fixture.manifest,
      parseSnapshotEditKind(kind),
    );

    expect(result).toMatchObject({
      kind,
      finalTextLength: fixture.text.length + 2,
      finalTextValidated: true,
    });
    expect(result.statsAfterFirstEdit?.snapshotValidationReplays).toBe(1);
    expect(result.firstEditMs).toBeGreaterThanOrEqual(0);
    expect(result.secondEditMs).toBeGreaterThanOrEqual(0);
  });

  it("loads the same EGW3 bytes cold for the native lane", () => {
    const result = measureSnapshotFirstEdit(
      api,
      fixture.bytes,
      fixture.manifest,
      parseSnapshotEditKind("native"),
    );

    expect(result).toMatchObject({
      kind: "native",
      finalTextLength: fixture.text.length,
      finalTextSha256: fixture.manifest.textSha256,
    });
    expect(result.statsAfterFirstEdit?.fullReplays).toBe(1);
  });

  it.each([
    "native-concurrent-0",
    "native-concurrent-12",
  ])("times and validates the %s lane after a cold load", (kind) => {
    const result = measureSnapshotFirstEdit(
      api,
      fixture.bytes,
      fixture.manifest,
      parseSnapshotEditKind(kind),
    );

    expect(result).toMatchObject({
      kind,
      restoreMs: 0,
      finalTextLength: fixture.text.length + 2,
      finalTextValidated: true,
    });
    expect(result.statsAfterOpen).toMatchObject({
      snapshotValidationReplays: 0,
      fullReplays: 1,
    });
    expect(result.statsAfterFirstEdit?.fullReplays).toBe(1);
    expect(result.heapAfterOpenBytes).toBeGreaterThan(0);
    expect(result.nativeLoadMs).toBeGreaterThanOrEqual(0);
    expect(result.firstEditMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects a snapshot that does not match its manifest", () => {
    expect(() =>
      measureSnapshotFirstEdit(
        api,
        fixture.bytes,
        { ...fixture.manifest, textSha256: "0".repeat(64) },
        parseSnapshotEditKind("local"),
      ),
    ).toThrow(/digest mismatch/);
  });

  it("checks edited text exactly where the result is known", () => {
    const text = "abc";
    const edited = `${SECOND_EDIT_MARKER}${FIRST_EDIT_MARKER}${text}`;
    expect(() =>
      assertEditedText(edited, text, { type: "local" }),
    ).not.toThrow();
    expect(() =>
      assertEditedText(`a${FIRST_EDIT_MARKER}${SECOND_EDIT_MARKER}bc`, text, {
        type: "remote",
      }),
    ).toThrow(/edited text mismatch/);

    const concurrent = { type: "concurrent", depth: 1 } as const;
    expect(() =>
      assertEditedText(
        `a${SECOND_EDIT_MARKER}b${FIRST_EDIT_MARKER}c`,
        text,
        concurrent,
      ),
    ).not.toThrow();
    expect(() =>
      assertEditedText(
        `a${FIRST_EDIT_MARKER}b${SECOND_EDIT_MARKER}c`,
        text,
        concurrent,
      ),
    ).toThrow(/out of order/);
    expect(() =>
      assertEditedText(`${SECOND_EDIT_MARKER}ab`, text, concurrent),
    ).toThrow(/missing/);
    expect(() =>
      assertEditedText(
        `${SECOND_EDIT_MARKER}${FIRST_EDIT_MARKER}abd`,
        text,
        concurrent,
      ),
    ).toThrow(/differs from the snapshot/);
  });

  it("parses lane names", () => {
    expect(parseSnapshotEditKind("concurrent-1000")).toEqual({
      type: "concurrent",
      depth: 1000,
    });
    expect(parseSnapshotEditKind("native-concurrent-10000")).toEqual({
      type: "native-concurrent",
      depth: 10000,
    });
    expect(() => parseSnapshotEditKind("native-local")).toThrow(
      /Unknown snapshot edit kind/,
    );
    expect(() => parseSnapshotEditKind("concurrent-x")).toThrow(
      /Unknown snapshot edit kind/,
    );
    expect(() => parseSnapshotEditKind("remote-linear")).toThrow(
      /Unknown snapshot edit kind/,
    );
  });
});
