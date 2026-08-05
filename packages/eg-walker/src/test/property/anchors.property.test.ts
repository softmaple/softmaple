import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  captureAnchor,
  resolveAnchor,
  type AnchorAffinity,
} from "../../anchors";
import { EgWalkerReplica } from "../../core/replica";
import type { GraphEvent } from "../../types";
import {
  bootstrapReplica,
  cloneEvent,
  replicaFromEvents,
} from "../replica-test-helpers";
import { fcParams } from "./run-config";

describe("property: stable sequence anchors", () => {
  it("should round-trip every code-point boundary through JSON persistence", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        // Arrange
        const source = bootstrapReplica("source", text);
        const restored = EgWalkerReplica.deserialize(
          JSON.parse(JSON.stringify(source.serialize())) as ReturnType<
            EgWalkerReplica["serialize"]
          >,
          "restored",
        );

        // Act / Assert
        for (const boundary of codePointBoundaries(text)) {
          for (const affinity of ["before", "after"] as const) {
            const anchor = captureAnchor(source, boundary, affinity);
            const wire = JSON.parse(JSON.stringify(anchor)) as typeof anchor;
            expect(resolveAnchor(restored, wire)).toBe(boundary);
          }
        }
      }),
      fcParams(),
    );
  });

  it("should deterministically collapse any deleted bootstrap atom", () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (text, useBefore) => {
        // Arrange
        const replica = bootstrapReplica("source", text);
        const affinity: AnchorAffinity = useBefore ? "before" : "after";
        const anchors = codePointBoundaries(text).map((boundary) =>
          captureAnchor(replica, boundary, affinity),
        );

        // Act
        if (text.length > 0) {
          replica.delete(0, text.length);
        }

        // Assert
        expect(replica.getText()).toBe("");
        for (const anchor of anchors) {
          expect(resolveAnchor(replica, anchor)).toBe(0);
        }
      }),
      fcParams(),
    );
  });

  it("should resolve identically after out-of-order duplicate delivery", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (leftText, rightText) => {
        // Arrange
        const base = bootstrapReplica("seed", "|");
        const bootstrap = base.exportEventGraph()[0]!;
        const left = replicaFromEvents("left", [bootstrap]);
        const right = replicaFromEvents("right", [bootstrap]);
        const leftEvent = left.insert(1, leftText);
        const rightEvent = right.insert(1, rightText);
        const anchor = captureAnchor(base, 1, "after");
        const first = new EgWalkerReplica("first");
        const second = new EgWalkerReplica("second");
        const branchEvents = [leftEvent, rightEvent].filter(
          (event): event is GraphEvent => event !== null,
        );

        // Act
        for (const event of [bootstrap, ...branchEvents, ...branchEvents]) {
          first.applyRemoteEvent(cloneEvent(event));
        }
        for (const event of [
          ...[...branchEvents].reverse(),
          bootstrap,
          ...branchEvents,
        ]) {
          second.applyRemoteEvent(cloneEvent(event));
        }

        // Assert
        expect(first.getPendingRemoteCount()).toBe(0);
        expect(second.getPendingRemoteCount()).toBe(0);
        expect(first.getText()).toBe(second.getText());
        expect(resolveAnchor(first, anchor)).toBe(
          resolveAnchor(second, anchor),
        );
      }),
      fcParams(),
    );
  });
});

// Helpers

const codePointBoundaries = (text: string): number[] => {
  const boundaries = [0];
  let index = 0;
  for (const codePoint of text) {
    index += codePoint.length;
    boundaries.push(index);
  }
  return boundaries;
};
