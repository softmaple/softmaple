import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { compareEventIds } from "../graph/event-id";
import { EventIdTieBreaker } from "../graph/internals/event-id-tie-breaker";
import type { EventId } from "../types";
import { fcParams } from "./property/run-config";

describe("EventIdTieBreaker", () => {
  it("should order canonical sequences numerically within one replica", () => {
    // Arrange
    const ids = ["alice:10", "alice:2", "alice:1x"];
    const tieBreaker = tieBreakerOver(ids);

    // Act
    const sorted = sortRanks(tieBreaker, ids);

    // Assert
    expect(sorted).toEqual(["alice:2", "alice:10", "alice:1x"]);
  });

  it("should order canonical IDs by replica before sequence, ahead of custom IDs", () => {
    // Arrange
    const ids = ["custom", "bob:1", "alice:99", "alice:01"];
    const tieBreaker = tieBreakerOver(ids);

    // Act
    const sorted = sortRanks(tieBreaker, ids);

    // Assert
    expect(sorted).toEqual(["alice:99", "bob:1", "alice:01", "custom"]);
  });

  it("should always order two ranks like compareEventIds orders their IDs", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(eventIdArb, { minLength: 1 }),
        fc.nat(),
        fc.nat(),
        (ids, leftSeed, rightSeed) => {
          // Arrange
          const tieBreaker = tieBreakerOver(ids);
          const left = leftSeed % ids.length;
          const right = rightSeed % ids.length;

          // Act
          const order = Math.sign(tieBreaker.compare(left, right));

          // Assert
          expect(order).toBe(
            Math.sign(compareEventIds(ids[left]!, ids[right]!)),
          );
        },
      ),
      fcParams(),
    );
  });

  it("should sort any IDs exactly like compareEventIds", () => {
    fc.assert(
      fc.property(fc.uniqueArray(eventIdArb), (ids) => {
        // Arrange
        const tieBreaker = tieBreakerOver(ids);

        // Act
        const sorted = sortRanks(tieBreaker, ids);

        // Assert
        expect(sorted).toEqual([...ids].sort(compareEventIds));
      }),
      fcParams(),
    );
  });
});

// Helpers

/**
 * IDs over a tiny alphabet, so generated IDs share replica prefixes and
 * produce canonical, leading-zero, empty-prefix and trailing-colon forms.
 */
const eventIdArb: fc.Arbitrary<EventId> = fc.string({
  minLength: 1,
  unit: fc.constantFrom("a", "b", ":", "0", "1", "9"),
});

const tieBreakerOver = (ids: ReadonlyArray<EventId>): EventIdTieBreaker =>
  new EventIdTieBreaker(ids.length, (rank) => ids[rank]!);

const sortRanks = (
  tieBreaker: EventIdTieBreaker,
  ids: ReadonlyArray<EventId>,
): EventId[] =>
  ids
    .map((_, rank) => rank)
    .sort((left, right) => tieBreaker.compare(left, right))
    .map((rank) => ids[rank]!);
