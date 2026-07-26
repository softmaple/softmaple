import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { assertPendingCandidatesAcyclic } from "../core/internals/pending-causality";
import type { EventId, GraphEvent } from "../types";

describe("assertPendingCandidatesAcyclic", () => {
  it("should reject a cycle through an existing buffered event", () => {
    // Arrange
    const buffered = insertEvent("buffered:0", ["candidate:0", "missing:0"]);
    const candidate = insertEvent("candidate:0", [buffered.id]);

    // Act / Assert
    expect(() =>
      assertPendingCandidatesAcyclic([candidate], (eventId) =>
        eventId === buffered.id ? buffered : undefined,
      ),
    ).toThrow(/causal cycle/);
  });

  it("should visit only pending ancestors reachable from candidates", () => {
    // Arrange
    const unrelated = new Map<EventId, GraphEvent>(
      Array.from({ length: 1_600 }, (_, index) => {
        const event = insertEvent(`orphan:${index}`, [`missing:${index}`]);
        return [event.id, event] as const;
      }),
    );
    const candidate = insertEvent("candidate:0", ["unknown:0"]);

    // Act
    const visited = assertPendingCandidatesAcyclic([candidate], (eventId) =>
      unrelated.get(eventId),
    );

    // Assert
    expect(visited).toBe(1);
  });

  it("should traverse a deep candidate chain iteratively", () => {
    // Arrange
    const events = Array.from({ length: 4_000 }, (_, index) =>
      insertEvent(`deep:${index}`, index === 0 ? [] : [`deep:${index - 1}`]),
    );

    // Act
    const visited = assertPendingCandidatesAcyclic(events, () => undefined);

    // Assert
    expect(visited).toBe(events.length);
  });
});

// Helpers

const insertEvent = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
  timestamp: 0,
});
