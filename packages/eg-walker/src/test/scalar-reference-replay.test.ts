import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import {
  materializeScalarReferenceVersion,
  scalarReferenceFrontier,
  ScalarReferenceSession,
} from "../conformance/scalar-reference-replay";
import type { GraphEvent } from "../types";
import { eventDagArb } from "./property/arbitraries";
import { fcParams } from "./property/run-config";

describe("ScalarReferenceSession", () => {
  it("should match the stateless oracle across Unicode merge versions", () => {
    // Arrange
    const events = unicodeMergeEvents();
    const session = new ScalarReferenceSession();
    const applied: GraphEvent[] = [];

    // Act and assert
    for (const event of events) {
      expect(session.materializeVersion(event.parentVersion)).toBe(
        materializeScalarReferenceVersion(applied, event.parentVersion),
      );
      session.applyEvent(event);
      applied.push(event);
    }
    const frontier = scalarReferenceFrontier(events);
    expect(session.materializeVersion(frontier)).toBe("AB");
    expect(session.getStats()).toMatchObject({ eventsApplied: events.length });
  });

  it("should retreat and re-advance delete targets across a merge", () => {
    // Arrange
    const events = deleteMergeEvents();
    const session = new ScalarReferenceSession();
    const applied: GraphEvent[] = [];

    // Act and assert
    for (const event of events) {
      expect(session.materializeVersion(event.parentVersion)).toBe(
        materializeScalarReferenceVersion(applied, event.parentVersion),
      );
      session.applyEvent(event);
      applied.push(event);
    }
    const frontier = scalarReferenceFrontier(events);
    expect(session.materializeVersion(frontier)).toBe("BC");
    expect(session.materializeVersion(new Set(["root:0"]))).toBe("A");
    expect(session.materializeVersion(new Set(["delete:0"]))).toBe("");
  });

  it("should allow a corrected event ID after validation fails", () => {
    // Arrange
    const session = new ScalarReferenceSession();
    session.applyEvent({
      id: "root:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 0,
    });
    const invalid: GraphEvent = {
      id: "child:0",
      parentVersion: new Set(["root:0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "BC" },
      timestamp: 1,
    };

    // Act
    expect(() => session.applyEvent(invalid)).toThrow(
      /must insert exactly one Unicode scalar/,
    );
    session.applyEvent({
      ...invalid,
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
    });

    // Assert
    expect(session.materializeVersion(new Set(["child:0"]))).toBe("AB");
    expect(session.getStats().eventsApplied).toBe(2);
  });

  it("should always match the stateless oracle at every generated version", () => {
    fc.assert(
      fc.property(eventDagArb({}), (generated) => {
        // Arrange
        const events = generated.map(toScalarInsert);
        const session = new ScalarReferenceSession();
        const applied: GraphEvent[] = [];

        // Act and assert
        for (const event of events) {
          expect(session.materializeVersion(event.parentVersion)).toBe(
            materializeScalarReferenceVersion(applied, event.parentVersion),
          );
          session.applyEvent(event);
          applied.push(event);
        }
        const frontier = scalarReferenceFrontier(events);
        expect(session.materializeVersion(frontier)).toBe(
          materializeScalarReferenceVersion(events, frontier),
        );
        expect(session.getStats().eventsApplied).toBe(events.length);
      }),
      fcParams(),
    );
  });
});

// Helpers

const unicodeMergeEvents = (): GraphEvent[] => [
  {
    id: "root:0",
    parentVersion: new Set(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "😀" },
    timestamp: 0,
  },
  {
    id: "left:0",
    parentVersion: new Set(["root:0"]),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
    timestamp: 1,
  },
  {
    id: "right:0",
    parentVersion: new Set(["root:0"]),
    operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "B" },
    timestamp: 2,
  },
  {
    id: "merge:0",
    parentVersion: new Set(["left:0", "right:0"]),
    operation: { type: OPERATION_TYPE.DELETE, index: 1, length: 2 },
    timestamp: 3,
  },
];

const deleteMergeEvents = (): GraphEvent[] => [
  {
    id: "root:0",
    parentVersion: new Set(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
    timestamp: 0,
  },
  {
    id: "delete:0",
    parentVersion: new Set(["root:0"]),
    operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
    timestamp: 1,
  },
  {
    id: "sibling:0",
    parentVersion: new Set(["root:0"]),
    operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
    timestamp: 2,
  },
  {
    id: "merge:0",
    parentVersion: new Set(["delete:0", "sibling:0"]),
    operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "C" },
    timestamp: 3,
  },
];

const toScalarInsert = (event: GraphEvent): GraphEvent => ({
  ...event,
  operation: {
    type: OPERATION_TYPE.INSERT,
    index: event.operation.index,
    text:
      event.operation.type === OPERATION_TYPE.INSERT
        ? Array.from(event.operation.text)[0]!
        : "x",
  },
});
