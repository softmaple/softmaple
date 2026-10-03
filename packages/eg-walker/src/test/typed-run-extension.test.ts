/**
 * Typed-run extension inside a document.
 *
 * A one-character insert that lands right after a typed-run record of its
 * author, with the next sequence number, joins that record wherever the
 * record sits in the document: typing inside a document keeps one record
 * per stretch of keystrokes instead of one per keystroke. The record stands
 * for the chain of one-character items it replaces, so the extension is
 * allowed only where the chain would carry the same origins: the record has
 * no right origin, and no record names it as its left origin.
 *
 * The cases with concurrent edits check the document against the scalar
 * reference replay, which keeps one item per code unit and shares no engine
 * code.
 */

import { describe, expect, it } from "vitest";

import { materializeScalarReferenceVersion } from "../conformance/scalar-reference-replay";
import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { EventGraph } from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";

describe("typed-run extension inside a document", () => {
  it.each([
    true,
    false,
  ])("should keep keystrokes typed inside a document in one record (transformed operations: %s)", (collectTransformedOperations) => {
    // Arrange
    const events = typing("alice", [], 3, "XYZ");

    // Act
    const generated = new EgWalkerEngine().generate(events, "abcdef", {
      eventGraph: EventGraph.fromEvents(events),
      collectTransformedOperations,
    });

    // Assert
    expect(generated.text).toBe("abcXYZdef");
    // "abc", "XYZ" and "def": the initial text splits once.
    expect(generated.stats.sequenceRecordCount).toBe(3);
  });

  it("should report each keystroke typed inside a document at its own index", () => {
    // Arrange
    const events = typing("alice", [], 3, "XYZ");

    // Act
    const generated = new EgWalkerEngine().generate(events, "abcdef", {
      eventGraph: EventGraph.fromEvents(events),
    });

    // Assert
    expect(generated.transformedOperations).toEqual([
      { type: OPERATION_TYPE.INSERT, index: 3, text: "X" },
      { type: OPERATION_TYPE.INSERT, index: 4, text: "Y" },
      { type: OPERATION_TYPE.INSERT, index: 5, text: "Z" },
    ]);
  });

  it("should retreat keystrokes typed inside a document with one toggle", () => {
    // Arrange
    const events = [
      ...typing("alice", [], 3, "XYZ"),
      insert("bob:0", [], 0, "Q"),
    ];

    // Act
    const generated = new EgWalkerEngine().generate(events, "abcdef", {
      eventGraph: EventGraph.fromEvents(events),
      eventOrder: events,
      collectTransformedOperations: false,
    });

    // Assert
    expect(generated.text).toBe(reference(events, "abcdef"));
    expect(generated.stats.retreatCount).toBe(3);
    expect(generated.stats.prepareToggleCount).toBe(1);
  });

  it("should extend a run that a concurrent record follows", () => {
    // Arrange: bob's "y" lands right after alice's "x", and is retreated
    // when alice types "1" after her "x".
    const events = [
      insert("alice:0", [], 1, "x"),
      insert("bob:0", [], 1, "y"),
      insert("alice:1", ["alice:0"], 2, "1"),
    ];

    // Act
    const generated = new EgWalkerEngine().generate(events, "ab", {
      eventGraph: EventGraph.fromEvents(events),
      eventOrder: events,
    });

    // Assert
    expect(generated.text).toBe("ax1yb");
    expect(generated.text).toBe(reference(events, "ab"));
    // "a", "x1", "y" and "b".
    expect(generated.stats.sequenceRecordCount).toBe(4);
  });

  it("should not extend a record that has a right origin", () => {
    // Arrange: quinn's "y" goes before "x", so its record has "x" as its
    // right origin. Quinn then types "12" after "y", and zoe inserts "c"
    // after "y" concurrently. "1" has no right origin, so zoe's "c", a
    // sibling with the same origins and a later ID, goes after "12".
    const events = [
      insert("pat:0", [], 0, "x"),
      insert("quinn:0", ["pat:0"], 0, "y"),
      ...typing("quinn", ["quinn:0"], 1, "12", 1),
      insert("zoe:0", ["quinn:0"], 1, "c"),
    ];

    // Act
    const generated = new EgWalkerEngine().generate(events, "", {
      eventGraph: EventGraph.fromEvents(events),
      eventOrder: events,
    });

    // Assert
    expect(generated.text).toBe("y12cx");
    expect(generated.text).toBe(reference(events));
  });

  it("should not extend a record that another record names as its left origin", () => {
    // Arrange: cleo inserts "z" after quinn's "a" before quinn types "b"
    // after it. The two are siblings with the same origins, and cleo's
    // earlier ID puts "z" first.
    const events = [
      insert("quinn:0", [], 0, "a"),
      insert("cleo:0", ["quinn:0"], 1, "z"),
      insert("quinn:1", ["quinn:0"], 1, "b"),
    ];

    // Act
    const generated = new EgWalkerEngine().generate(events, "", {
      eventGraph: EventGraph.fromEvents(events),
      eventOrder: events,
    });

    // Assert
    expect(generated.text).toBe("azb");
    expect(generated.text).toBe(reference(events));
  });
});

// Helpers

const insert = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  index: number,
  text: string,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: OPERATION_TYPE.INSERT, index, text },
  timestamp: 0,
});

/**
 * `replica` types `text` one character per event at `index`, starting at
 * sequence `firstSequence`; the first keystroke's parents are `parents`.
 */
const typing = (
  replica: string,
  parents: ReadonlyArray<EventId>,
  index: number,
  text: string,
  firstSequence = 0,
): GraphEvent[] =>
  [...text].map((character, offset) =>
    insert(
      `${replica}:${firstSequence + offset}`,
      offset === 0 ? parents : [`${replica}:${firstSequence + offset - 1}`],
      index + offset,
      character,
    ),
  );

/** The scalar reference document of every event. */
const reference = (
  events: ReadonlyArray<GraphEvent>,
  initialText = "",
): string =>
  materializeScalarReferenceVersion(
    events,
    EventGraph.fromEvents(events).getFrontier(),
    initialText,
  );
