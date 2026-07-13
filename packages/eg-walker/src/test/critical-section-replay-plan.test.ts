import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { planCriticalReplaySections } from "../engine/critical-section-replay-plan";
import { EventGraph } from "../graph/event-graph";
import type { EventId, GraphEvent, Version } from "../types";

const event = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  timestamp: number,
): GraphEvent => ({
  id,
  operation: { type: OPERATION_TYPE.INSERT, index: 0, text: id },
  parentVersion: new Set(parents),
  timestamp,
});

const sectionIds = (
  sections: ReturnType<typeof planCriticalReplaySections>,
): string[][] => sections.map((section) => section.events.map(({ id }) => id));

const sortedVersion = (version: Version): EventId[] =>
  Array.from(version).sort();

describe("critical-section replay planning", () => {
  it("collapses a directly-causal history into one rope-only section", () => {
    const events = [
      event("r:0", [], 0),
      event("r:1", ["r:0"], 1),
      event("r:2", ["r:1"], 2),
    ];

    const sections = planCriticalReplaySections(events);

    expect(sectionIds(sections)).toEqual([["r:0", "r:1", "r:2"]]);
    expect(
      sections.map(({ baseFrontier, endFrontier }) => [
        sortedVersion(baseFrontier),
        sortedVersion(endFrontier),
      ]),
    ).toEqual([[[], ["r:2"]]]);
  });

  it("keeps concurrent branches together until every ready root shares the prefix frontier", () => {
    const events = [
      event("root", [], 0),
      event("a:0", ["root"], 1),
      event("a:1", ["a:0"], 2),
      event("b:0", ["root"], 3),
      event("b:1", ["b:0"], 4),
      event("merge", ["a:1", "b:1"], 5),
      event("tail", ["merge"], 6),
    ];

    const sections = planCriticalReplaySections(events);

    expect(sectionIds(sections)).toEqual([
      ["root"],
      ["a:0", "a:1", "b:0", "b:1"],
      ["merge"],
      ["tail"],
    ]);
    expect(sortedVersion(sections[1]!.baseFrontier)).toEqual(["root"]);
    expect(sortedVersion(sections[1]!.endFrontier)).toEqual(["a:1", "b:1"]);
  });

  it("always emits the final multi-tip frontier when branches never rejoin", () => {
    const events = [
      event("root", [], 0),
      event("a:0", ["root"], 1),
      event("a:1", ["a:0"], 2),
      event("b:0", ["root"], 3),
      event("b:1", ["b:0"], 4),
    ];

    const sections = planCriticalReplaySections(events);

    expect(sectionIds(sections)).toEqual([
      ["root"],
      ["a:0", "a:1", "b:0", "b:1"],
    ]);
    expect(sortedVersion(sections.at(-1)!.endFrontier)).toEqual(["a:1", "b:1"]);
  });

  it("accepts redundant ancestor parents when every frontier tip is shared", () => {
    const events = [
      event("root", [], 0),
      event("a", ["root"], 1),
      event("b", ["root"], 2),
      event("merge", ["root", "a", "b"], 3),
    ];

    const sections = planCriticalReplaySections(events);

    expect(sectionIds(sections)).toEqual([["root"], ["a", "b"], ["merge"]]);
    expect(sortedVersion(sections[1]!.endFrontier)).toEqual(["a", "b"]);
  });

  it("uses EventGraph's deterministic branch-preserving order", () => {
    const graph = EventGraph.fromEvents([
      event("merge", ["a:1", "b:1"], 5),
      event("b:1", ["b:0"], 4),
      event("root", [], 0),
      event("a:1", ["a:0"], 2),
      event("b:0", ["root"], 3),
      event("a:0", ["root"], 1),
    ]);

    const sections = planCriticalReplaySections(graph);

    expect(sectionIds(sections)).toEqual([
      ["root"],
      ["a:0", "a:1", "b:0", "b:1"],
      ["merge"],
    ]);
    expect(sortedVersion(sections.at(-1)!.endFrontier)).toEqual(
      sortedVersion(graph.getFrontier()),
    );
  });

  it("rejects incomplete and non-topological ordered inputs", () => {
    expect(() =>
      planCriticalReplaySections([event("child", ["missing"], 1)]),
    ).toThrow(/Unknown parent missing/);

    expect(() =>
      planCriticalReplaySections([
        event("child", ["root"], 1),
        event("root", [], 0),
      ]),
    ).toThrow(/event child is not ready/);

    expect(() =>
      planCriticalReplaySections([
        event("duplicate", [], 0),
        event("duplicate", ["duplicate"], 1),
      ]),
    ).toThrow(/Duplicate event ID/);
  });

  it("returns no replay work for an empty graph", () => {
    expect(planCriticalReplaySections([])).toEqual([]);
    expect(planCriticalReplaySections(new EventGraph())).toEqual([]);
  });
});
