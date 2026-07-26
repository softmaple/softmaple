import { describe, expect, it } from "vitest";
import { EgWalkerReplica } from "../core/replica";
import { EventGraph } from "../graph/event-graph";
import type { GraphEvent } from "../types";

// Regression tests for the gap the #689 review flagged: prebuilt
// `EventGraph` inputs and `EgWalkerReplica.deserialize` bypass
// `applyRemoteEvent`, so malformed UTF-16 (lone surrogates) and invalid
// delete lengths could previously slip past the public-boundary guard
// straight into `fullReplay()`. The constructor now screens every event
// in a prebuilt graph before replay.
describe("deserialize / prebuilt EventGraph reject malformed UTF-16", () => {
  it("constructor with prebuilt EventGraph containing a lone surrogate is rejected", () => {
    const graph = new EventGraph();
    const lone: GraphEvent = {
      id: "evil:0",
      operation: { type: "insert", index: 0, text: "\uD83D" }, // lone high surrogate
      parentVersion: new Set<string>(),
      timestamp: 1,
    };
    graph.addEvent(lone);

    expect(() => new EgWalkerReplica("r", "", graph)).toThrow(/surrogate/);
  });

  it("EgWalkerReplica.fromEventGraph rejects malformed UTF-16", () => {
    const lone: GraphEvent = {
      id: "evil:0",
      operation: { type: "insert", index: 0, text: "\uDC00" }, // lone low surrogate
      parentVersion: new Set<string>(),
      timestamp: 1,
    };
    expect(() => EgWalkerReplica.fromEventGraph("r", [lone], "")).toThrow(
      /surrogate/,
    );
  });

  it("EgWalkerReplica.deserialize rejects malformed UTF-16 in event payloads", () => {
    // Build a legitimate replica, append a malformed event by hand, serialize.
    const source = new EgWalkerReplica("source", "");
    source.insert(0, "ok");
    const serialized = source.serialize();
    // Tamper with the serialized payload by adding a malformed event.
    const tampered = {
      text: serialized.text,
      eventGraph: {
        ...serialized.eventGraph,
        version: ["evil:0"],
        events: [
          ...serialized.eventGraph.events,
          {
            id: "evil:0",
            operation: { type: "insert" as const, index: 2, text: "\uD83D" },
            parentVersion: serialized.eventGraph.events
              .slice(-1)
              .map((e) => e.id),
            timestamp: 2,
          },
        ],
      },
    };
    expect(() => EgWalkerReplica.deserialize(tampered)).toThrow(/surrogate/);
  });

  it("invalid delete length in a prebuilt graph is rejected", () => {
    const graph = new EventGraph();
    const evil: GraphEvent = {
      id: "evil:0",
      operation: { type: "delete", index: 0, length: -1 },
      parentVersion: new Set<string>(),
      timestamp: 1,
    };
    graph.addEvent(evil);
    expect(() => new EgWalkerReplica("r", "abc", graph)).toThrow(
      /delete length/,
    );
  });
});
