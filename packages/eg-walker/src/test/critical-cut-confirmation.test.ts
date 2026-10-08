import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import {
  advanceCriticalCut,
  CRITICAL_CUT_CONFIRMATION_EVENTS,
  emptyIntervalAuthors,
  isCriticalCutConfirmed,
  MAX_CONFIRMING_AUTHORS,
  openCriticalCut,
  scanIntervalAuthors,
  type PendingCriticalCut,
} from "../core/internals/critical-cut-confirmation";
import { EventGraph } from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";

describe("critical cut confirmation", () => {
  it("should wait for every author of the interval but the settled ones", () => {
    // Arrange: alice, bob and carol type concurrently, and alice merges.
    const graph = EventGraph.fromEvents([
      insert("alice:0", []),
      insert("bob:0", []),
      insert("carol:0", []),
      insert("alice:1", ["alice:0", "bob:0", "carol:0"]),
    ]);
    const authors = scanIntervalAuthors(emptyIntervalAuthors(0), graph, 4);

    // Act
    const cut = openCriticalCut(4, authors, [agent(graph, "alice")]);

    // Assert
    expect(cut.awaitingAgents).toEqual(
      new Set([agent(graph, "bob"), agent(graph, "carol")]),
    );
    expect(isCriticalCutConfirmed(cut)).toBe(false);
  });

  it("should be confirmed once every awaited author has built on the cut", () => {
    // Arrange
    const events = [
      insert("alice:0", []),
      insert("bob:0", []),
      insert("alice:1", ["alice:0", "bob:0"]),
    ];
    const graph = EventGraph.fromEvents(events);
    const cut = openCriticalCut(
      3,
      scanIntervalAuthors(emptyIntervalAuthors(0), graph, 3),
      [agent(graph, "alice")],
    );
    graph.addEvent(insert("alice:2", ["alice:1"]));
    graph.addEvent(insert("bob:1", ["alice:2"]));

    // Act
    const advanced = advanceCriticalCut(cut, graph, 5)!;

    // Assert
    expect(advanced.awaitingAgents).toEqual(new Set());
    expect(isCriticalCutConfirmed(advanced)).toBe(true);
    expect(cut.awaitingAgents).toEqual(new Set([agent(graph, "bob")]));
  });

  it("should be cancelled by an event concurrent with the cut", () => {
    // Arrange: bob's second edit was typed before he saw alice's merge.
    const graph = EventGraph.fromEvents([
      insert("alice:0", []),
      insert("bob:0", []),
      insert("alice:1", ["alice:0", "bob:0"]),
    ]);
    const cut = openCriticalCut(
      3,
      scanIntervalAuthors(emptyIntervalAuthors(0), graph, 3),
      [agent(graph, "alice")],
    );
    graph.addEvent(insert("alice:2", ["alice:1"]));
    graph.addEvent(insert("bob:1", ["bob:0"]));

    // Act
    const advanced = advanceCriticalCut(cut, graph, 5);

    // Assert
    expect(advanced).toBeNull();
  });

  it("should be confirmed by descendant events alone when it has too many authors to wait for", () => {
    // Arrange: more authors than a cut waits for, then one author's chain
    // after their merge.
    const writers = MAX_CONFIRMING_AUTHORS + 1;
    const firsts = Array.from({ length: writers }, (_unused, index) =>
      insert(`writer${index}:0`, []),
    );
    const graph = EventGraph.fromEvents([
      ...firsts,
      insert(
        "writer0:1",
        firsts.map((event) => event.id),
      ),
    ]);
    const authors = scanIntervalAuthors(
      emptyIntervalAuthors(0),
      graph,
      writers + 1,
    );
    const cut = openCriticalCut(writers + 1, authors, []);
    const chainTo = (length: number): PendingCriticalCut => {
      for (let index = 2; index < length + 2; index++) {
        if (!graph.hasEvent(`writer0:${index}`)) {
          graph.addEvent(insert(`writer0:${index}`, [`writer0:${index - 1}`]));
        }
      }
      return advanceCriticalCut(cut, graph, graph.getEventCount())!;
    };

    // Act
    const almost = chainTo(CRITICAL_CUT_CONFIRMATION_EVENTS - 1);
    const confirmed = chainTo(CRITICAL_CUT_CONFIRMATION_EVENTS);

    // Assert
    expect(authors.agents).toBeNull();
    expect(cut.awaitingAgents).toBeNull();
    expect(isCriticalCutConfirmed(almost)).toBe(false);
    expect(isCriticalCutConfirmed(confirmed)).toBe(true);
  });

  it("should extend the authors it has counted without changing them", () => {
    // Arrange
    const graph = EventGraph.fromEvents([
      insert("alice:0", []),
      insert("bob:0", ["alice:0"]),
      insert("carol:0", ["bob:0"]),
    ]);
    const first = scanIntervalAuthors(emptyIntervalAuthors(0), graph, 2);

    // Act
    const second = scanIntervalAuthors(first, graph, 3);

    // Assert
    expect(first).toEqual({
      agents: new Set([agent(graph, "alice"), agent(graph, "bob")]),
      scannedEventCount: 2,
    });
    expect(second).toEqual({
      agents: new Set([
        agent(graph, "alice"),
        agent(graph, "bob"),
        agent(graph, "carol"),
      ]),
      scannedEventCount: 3,
    });
    expect(scanIntervalAuthors(second, graph, 3)).toBe(second);
  });
});

// Helpers

const insert = (id: EventId, parents: ReadonlyArray<EventId>): GraphEvent => ({
  id,
  operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
  parentVersion: new Set(parents),
  timestamp: 0,
});

const agent = (graph: EventGraph, replicaId: string): number =>
  graph.agentTable.numberOf(replicaId);
