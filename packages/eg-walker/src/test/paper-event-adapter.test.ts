import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { PaperEventAdapter } from "../conformance/paper-event-adapter";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { EventGraph } from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";
import { fcParams } from "./property/run-config";

describe("PaperEventAdapter.expand", () => {
  it("should expand an insert into one event per Unicode scalar", () => {
    // Arrange
    const source: GraphEvent = {
      id: "alice:10",
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: "A😀e\u0301👩‍💻",
      },
      parentVersion: new Set(),
      timestamp: 42,
    };

    // Act
    const expansion = new PaperEventAdapter().expand([source]);

    // Assert
    expect(expansion.events.map(({ operation }) => operation)).toEqual([
      { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      { type: OPERATION_TYPE.INSERT, index: 1, text: "😀" },
      { type: OPERATION_TYPE.INSERT, index: 3, text: "e" },
      { type: OPERATION_TYPE.INSERT, index: 4, text: "\u0301" },
      { type: OPERATION_TYPE.INSERT, index: 5, text: "👩" },
      { type: OPERATION_TYPE.INSERT, index: 7, text: "‍" },
      { type: OPERATION_TYPE.INSERT, index: 8, text: "💻" },
    ]);
    expect(expansion.events[0]?.id).toBe(source.id);
    expect(
      expansion.events.map(({ id }) => expansion.identities.get(id)),
    ).toEqual(
      Array.from({ length: 7 }, (_unused, offset) => ({
        sourceEventId: source.id,
        offset,
      })),
    );
    for (let offset = 1; offset < expansion.events.length; offset++) {
      expect(expansion.events[offset]?.parentVersion).toEqual(
        new Set([expansion.events[offset - 1]!.id]),
      );
    }
  });

  it("should split a compound delete using the parent view's scalar widths", () => {
    // Arrange
    const initialText = "x😀e\u0301👩‍💻y";
    const source: GraphEvent = {
      id: "alice:0",
      operation: {
        type: OPERATION_TYPE.DELETE,
        index: 1,
        length: 9,
      },
      parentVersion: new Set(),
      timestamp: 1,
    };

    // Act
    const expansion = new PaperEventAdapter(initialText).expand([source]);

    // Assert
    expect(expansion.events.map(({ operation }) => operation)).toEqual([
      { type: OPERATION_TYPE.DELETE, index: 1, length: 2 },
      { type: OPERATION_TYPE.DELETE, index: 1, length: 1 },
      { type: OPERATION_TYPE.DELETE, index: 1, length: 1 },
      { type: OPERATION_TYPE.DELETE, index: 1, length: 2 },
      { type: OPERATION_TYPE.DELETE, index: 1, length: 1 },
      { type: OPERATION_TYPE.DELETE, index: 1, length: 2 },
    ]);
    expect(materialize(expansion.events, initialText)).toBe("xy");
    expect(materialize(expansion.events, initialText)).toBe(
      materialize([source], initialText),
    );
  });

  it("should preserve compound semantics across a multi-parent frontier", () => {
    // Arrange
    const events: GraphEvent[] = [
      insertEvent("root:0", [], 0, "A😀B"),
      insertEvent("alice:0", ["root:0"], 4, "👩‍💻"),
      deleteEvent("bob:0", ["root:0"], 1, 2),
      insertEvent("merge:0", ["alice:0", "bob:0"], 7, "e\u0301"),
    ];

    // Act
    const firstExpansion = new PaperEventAdapter().expand(events);
    const secondExpansion = new PaperEventAdapter().expand(events);

    // Assert
    expect(materialize(firstExpansion.events)).toBe(materialize(events));
    expect(firstExpansion.events).toEqual(secondExpansion.events);
    const mergeScalars = firstExpansion.events.filter(
      ({ id }) =>
        firstExpansion.identities.get(id)?.sourceEventId === "merge:0",
    );
    expect(mergeScalars[0]?.parentVersion.size).toBe(2);
  });

  it("should stream a long linear expansion through one engine", () => {
    // Arrange
    const eventCount = 2_000;
    const events = Array.from({ length: eventCount }, (_, index) =>
      insertEvent(
        `author:${index}`,
        index === 0 ? [] : [`author:${index - 1}`],
        index,
        "x",
      ),
    );
    const generate = vi.spyOn(EgWalkerEngine.prototype, "generate");

    try {
      // Act
      const expansion = new PaperEventAdapter().expand(events);

      // Assert
      expect(expansion.events).toHaveLength(eventCount);
      expect(generate).toHaveBeenCalledTimes(1);
    } finally {
      generate.mockRestore();
    }
  });

  it("should stream a Unicode merge through an empty-event alias", () => {
    // Arrange
    const events: GraphEvent[] = [
      insertEvent("root:0", [], 0, "😀"),
      insertEvent("a:0", ["root:0"], 0, "A"),
      insertEvent("a:1", ["a:0"], 3, ""),
      insertEvent("b:0", ["root:0"], 2, "B"),
      deleteEvent("merge:0", ["a:1", "b:0"], 1, 2),
    ];

    // Act
    const expansion = new PaperEventAdapter().expand(events);

    // Assert
    expect(materialize(expansion.events)).toBe("AB");
    expect(materialize(expansion.events)).toBe(materialize(events));
    expect(expansion.events.some(({ id }) => id === "a:1")).toBe(false);
    expect(
      expansion.events.find(({ id }) => id === "merge:0")?.parentVersion,
    ).toEqual(new Set(["a:0", "b:0"]));
  });

  it("should preserve causality while removing empty compound events", () => {
    // Arrange
    const events: GraphEvent[] = [
      insertEvent("empty:0", [], 0, ""),
      insertEvent("child:0", ["empty:0"], 0, "😀"),
    ];

    // Act
    const expansion = new PaperEventAdapter().expand(events);

    // Assert
    expect(expansion.events).toHaveLength(1);
    expect(expansion.events[0]).toMatchObject({
      id: "child:0",
      parentVersion: new Set(),
    });
    expect(materialize(expansion.events)).toBe(materialize(events));
  });

  it("should reject indexes that split a surrogate pair", () => {
    // Arrange
    const insert = insertEvent("insert:0", [], 1, "x");
    const deletion = deleteEvent("delete:0", [], 0, 1);

    // Act
    const expandInsert = (): void => {
      new PaperEventAdapter("😀").expand([insert]);
    };
    const expandDelete = (): void => {
      new PaperEventAdapter("😀").expand([deletion]);
    };

    // Assert
    expect(expandInsert).toThrow(/splits a Unicode scalar/);
    expect(expandDelete).toThrow(/splits a Unicode scalar/);
  });

  it("should match compound edits for generated Unicode scalar ranges", () => {
    fc.assert(
      fc.property(editScenarioArb, ({ initialText, events }) => {
        // Arrange
        const compoundText = materialize(events, initialText);

        // Act
        const expansion = new PaperEventAdapter(initialText).expand(events);
        const scalarText = materialize(expansion.events, initialText);

        // Assert
        expect(scalarText).toBe(compoundText);
        for (const event of expansion.events) {
          if (event.operation.type === OPERATION_TYPE.INSERT) {
            expect(Array.from(event.operation.text)).toHaveLength(1);
          }
        }
      }),
      fcParams(),
    );
  });
});

// Helpers

const unicodeScalarArb = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: 0x20, max: 0x7e }) },
  { weight: 1, arbitrary: fc.integer({ min: 0xa1, max: 0xd7ff }) },
  { weight: 1, arbitrary: fc.integer({ min: 0xe000, max: 0xfffd }) },
  { weight: 4, arbitrary: fc.integer({ min: 0x10000, max: 0x10ffff }) },
  { weight: 1, arbitrary: fc.constant(0x0301) },
  { weight: 1, arbitrary: fc.constant(0x200d) },
);

const scalarArrayArb = fc
  .array(unicodeScalarArb)
  .map((codePoints) =>
    codePoints.map((codePoint) => String.fromCodePoint(codePoint)),
  );

const editScenarioArb = fc
  .tuple(scalarArrayArb, scalarArrayArb, fc.nat(), fc.nat())
  .map(([initialScalars, insertedScalars, startSeed, lengthSeed]) => {
    const start = startSeed % (initialScalars.length + 1);
    const available = initialScalars.length - start;
    const scalarLength = lengthSeed % (available + 1);
    const utf16Index = initialScalars.slice(0, start).join("").length;
    const utf16Length = initialScalars
      .slice(start, start + scalarLength)
      .join("").length;
    return {
      initialText: initialScalars.join(""),
      events: [
        deleteEvent("author:10", [], utf16Index, utf16Length),
        insertEvent(
          "author:11",
          ["author:10"],
          utf16Index,
          insertedScalars.join(""),
        ),
      ],
    };
  });

const insertEvent = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  index: number,
  text: string,
): GraphEvent => ({
  id,
  operation: { type: OPERATION_TYPE.INSERT, index, text },
  parentVersion: new Set(parents),
  timestamp: 0,
});

const deleteEvent = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  index: number,
  length: number,
): GraphEvent => ({
  id,
  operation: { type: OPERATION_TYPE.DELETE, index, length },
  parentVersion: new Set(parents),
  timestamp: 0,
});

const materialize = (
  events: ReadonlyArray<GraphEvent>,
  initialText: string = "",
): string => {
  const graph = EventGraph.fromEvents(events);
  const ordered = graph.getBranchPreservingTopologicalOrder();
  return new EgWalkerEngine().generate(ordered, initialText, {
    eventGraph: graph,
    eventOrder: ordered,
  }).text;
};
