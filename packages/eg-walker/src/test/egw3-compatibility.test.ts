import { describe, expect, it } from "vitest";

import { NativeSnapshotCodec } from "../core/native-snapshot";
import { PortableSnapshotCodec } from "../core/portable-snapshot-codec";
import { EgWalkerReplica } from "../core/replica";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import type { EventGraph } from "../graph/event-graph";
import { EGW3_MAGIC, EGW4_MAGIC } from "../graph/internals/binary-io";
import {
  EGW3_CONCURRENT_GRAPH,
  EGW3_LINEAR_GRAPH,
  EGWP1_WITH_EGW3_GRAPH,
  EGWS1_WITH_EGW3_GRAPH,
  type Egw3FixtureEvent,
  type Egw3GraphFixture,
} from "./fixtures/egw3-payloads";

const codec = new ColumnarEventGraphCodec();

const bytesOf = (base64: string): Uint8Array =>
  new Uint8Array(Buffer.from(base64, "base64"));

/** Events by ID, parents sorted, so equal graphs compare equal. */
const canonicalEvents = (
  events: ReadonlyArray<Egw3FixtureEvent>,
): Egw3FixtureEvent[] =>
  events
    .map((event) => ({ ...event, parents: [...event.parents].sort() }))
    .sort((left, right) => (left.id < right.id ? -1 : 1));

const graphEvents = (graph: EventGraph): Egw3FixtureEvent[] =>
  canonicalEvents(
    graph.getTopologicalOrder().map((event) => ({
      id: event.id,
      parents: [...event.parentVersion],
      operation: event.operation,
      timestamp: event.timestamp,
    })),
  );

const replayedText = (graph: EventGraph): string =>
  new EgWalkerReplica("egw3-check", "", graph).getText();

/** Whether `bytes` starts with the length-prefixed `magic`. */
const startsWithMagic = (bytes: Uint8Array, magic: Uint8Array): boolean =>
  bytes[0] === magic.length &&
  magic.every((byte, index) => bytes[index + 1] === byte);

describe("EGW3 compatibility", () => {
  it.each([
    ["a linear history", EGW3_LINEAR_GRAPH],
    ["a concurrent history with custom IDs", EGW3_CONCURRENT_GRAPH],
  ] as ReadonlyArray<
    readonly [string, Egw3GraphFixture]
  >)("decodes %s written by the EGW3 encoder", (_name, fixture) => {
    // Arrange
    const bytes = bytesOf(fixture.base64);

    // Act
    const graph = codec.decodeBinary(bytes);

    // Assert
    expect(startsWithMagic(bytes, EGW3_MAGIC)).toBe(true);
    expect(graphEvents(graph)).toEqual(canonicalEvents(fixture.events));
    expect([...graph.getFrontier()].sort()).toEqual(
      [...fixture.frontier].sort(),
    );
    expect(graph.getMetadata()).toEqual(fixture.metadata);
    expect(replayedText(graph)).toBe(fixture.text);
  });

  it.each([
    ["a linear history", EGW3_LINEAR_GRAPH],
    ["a concurrent history with custom IDs", EGW3_CONCURRENT_GRAPH],
  ] as ReadonlyArray<
    readonly [string, Egw3GraphFixture]
  >)("re-encodes %s as EGW4 without changing the graph", (_name, fixture) => {
    // Arrange
    const decoded = codec.decodeBinary(bytesOf(fixture.base64));

    // Act
    const reencoded = codec.encodeBinary(decoded);
    const migrated = codec.decodeBinary(reencoded);

    // Assert
    expect(startsWithMagic(reencoded, EGW4_MAGIC)).toBe(true);
    expect(graphEvents(migrated)).toEqual(canonicalEvents(fixture.events));
    expect(migrated.getMetadata()).toEqual(fixture.metadata);
    expect(replayedText(migrated)).toBe(fixture.text);
  });

  it("restores a portable snapshot whose graph is EGW3 and saves it as EGW4", () => {
    // Arrange
    const portableCodec = new PortableSnapshotCodec();
    const snapshot = portableCodec.decode(
      bytesOf(EGWP1_WITH_EGW3_GRAPH.base64),
    );

    // Act
    const replica = EgWalkerReplica.fromPortableSnapshot(snapshot, "restored");
    replica.insert(replica.getText().length, "!");
    const resaved = replica.createPortableSnapshot();
    const reopened = EgWalkerReplica.fromPortableSnapshot(
      portableCodec.decode(portableCodec.encode(resaved).slice()),
      "reopened",
    );

    // Assert
    expect(startsWithMagic(snapshot.eventGraph, EGW3_MAGIC)).toBe(true);
    expect(startsWithMagic(resaved.eventGraph, EGW4_MAGIC)).toBe(true);
    expect(replica.getText()).toBe(`${EGWP1_WITH_EGW3_GRAPH.text}!`);
    expect(reopened.getText()).toBe(`${EGWP1_WITH_EGW3_GRAPH.text}!`);
    expect(reopened.exportEventGraph()).toHaveLength(
      EGWP1_WITH_EGW3_GRAPH.eventCount + 1,
    );
  });

  it("restores a native snapshot whose graph is EGW3", () => {
    // Arrange
    const nativeCodec = new NativeSnapshotCodec();

    // Act
    const replica = EgWalkerReplica.fromNativeSnapshot(
      nativeCodec.decode(bytesOf(EGWS1_WITH_EGW3_GRAPH.base64)),
      "restored",
    );
    replica.insert(0, ">");

    // Assert
    expect(replica.getText()).toBe(`>${EGWS1_WITH_EGW3_GRAPH.text}`);
    expect(replica.exportEventGraph()).toHaveLength(
      EGWS1_WITH_EGW3_GRAPH.eventCount + 1,
    );
  });

  it("rejects truncated EGW3 payloads and trailing bytes", () => {
    // Arrange
    const bytes = bytesOf(EGW3_CONCURRENT_GRAPH.base64);
    const trailing = new Uint8Array(bytes.length + 1);
    trailing.set(bytes);

    // Act and assert
    for (let length = 0; length < bytes.length; length++) {
      expect(() => codec.decodeBinary(bytes.subarray(0, length))).toThrow(
        Error,
      );
    }
    expect(() => codec.decodeBinary(trailing)).toThrow(/trailing bytes/);
  });
});
