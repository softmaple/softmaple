import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EventGraph } from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";

describe("EventGraph.planInsertionSuffixSections", () => {
  it("should describe a chain after a checkpoint as one linear section", () => {
    // Arrange
    const graph = EventGraph.fromEvents(chain("author", 10));

    // Act
    const sections = graph.planInsertionSuffixSections(
      4,
      new Set(["author:3"]),
    );

    // Assert
    expect(sections).toEqual([
      { start: 4, end: 10, linear: true, baseFrontier: new Set(["author:3"]) },
    ]);
  });

  it("should cut a concurrent section at the event that merges it", () => {
    // Arrange
    const graph = EventGraph.fromEvents([
      ...chain("author", 3),
      insert("left:0", ["author:2"], 3),
      insert("right:0", ["author:2"], 3),
      insert("merge:0", ["left:0", "right:0"], 5),
      insert("tail:0", ["merge:0"], 6),
      insert("tail:1", ["tail:0"], 7),
    ]);

    // Act
    const sections = graph.planInsertionSuffixSections(
      1,
      new Set(["author:0"]),
    );

    // Assert
    expect(sections).toEqual([
      { start: 1, end: 3, linear: true, baseFrontier: new Set(["author:0"]) },
      { start: 3, end: 5, linear: false, baseFrontier: new Set(["author:2"]) },
      {
        start: 5,
        end: 8,
        linear: true,
        baseFrontier: new Set(["left:0", "right:0"]),
      },
    ]);
  });

  it("should keep branches that never merge in one final section", () => {
    // Arrange
    const graph = EventGraph.fromEvents([
      ...chain("author", 3),
      insert("left:0", ["author:2"], 3),
      insert("right:0", ["author:2"], 3),
      insert("left:1", ["left:0"], 4),
    ]);

    // Act
    const sections = graph.planInsertionSuffixSections(
      3,
      new Set(["author:2"]),
    );

    // Assert
    expect(sections).toEqual([
      { start: 3, end: 6, linear: false, baseFrontier: new Set(["author:2"]) },
    ]);
  });

  it("should return no section after the last event", () => {
    // Arrange
    const graph = EventGraph.fromEvents(chain("author", 3));

    // Act
    const sections = graph.planInsertionSuffixSections(
      3,
      new Set(["author:2"]),
    );

    // Assert
    expect(sections).toEqual([]);
  });

  it("should reject a frontier event outside the prefix", () => {
    // Arrange
    const graph = EventGraph.fromEvents(chain("author", 3));

    // Act
    const plan = () =>
      graph.planInsertionSuffixSections(2, new Set(["author:2"]));

    // Assert
    expect(plan).toThrow(/is not among the first 2 events/);
  });
});

describe("EventGraph.getRankedReplayEventsInRange", () => {
  it("should list a range in the same order as its event IDs", () => {
    // Arrange
    const graph = EventGraph.fromEvents([
      ...chain("author", 3),
      insert("right:0", ["author:2"], 3),
      insert("left:0", ["author:2"], 3),
      insert("left:1", ["left:0"], 4),
    ]);

    // Act
    const events = graph.getRankedReplayEventsInRange(3, 6);

    // Assert
    expect(events.map(({ id }) => id)).toEqual(
      graph.getRankedReplayOrder(new Set(["right:0", "left:0", "left:1"])),
    );
    expect(events).toEqual(events.map(({ id }) => graph.getEvent(id)));
  });

  it("should reject a range past the last event", () => {
    // Arrange
    const graph = EventGraph.fromEvents(chain("author", 3));

    // Act
    const order = () => graph.getRankedReplayEventsInRange(2, 4);

    // Assert
    expect(order).toThrow(/Invalid insertion rank range 2\.\.4/);
  });
});

// Helpers

const insert = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  index: number,
): GraphEvent => ({
  id,
  operation: { type: OPERATION_TYPE.INSERT, index, text: "x" },
  parentVersion: new Set(parents),
  timestamp: 0,
});

const chain = (replicaId: string, count: number): GraphEvent[] =>
  Array.from({ length: count }, (_unused, index) =>
    insert(
      `${replicaId}:${index}`,
      index === 0 ? [] : [`${replicaId}:${index - 1}`],
      index,
    ),
  );
