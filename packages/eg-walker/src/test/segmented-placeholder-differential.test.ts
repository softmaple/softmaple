import { describe, expect, it } from "vitest";
import {
  type PlaceholderPhysicalSlice,
  type PlaceholderRange,
  SegmentedPlaceholderState,
} from "../engine/internals/segmented-placeholder";

interface SliceOwner {
  readonly id: string;
}

const collectRanges = (
  start: number,
  end: number,
  visible: (offset: number) => boolean,
  maxLength: number = Number.POSITIVE_INFINITY,
): PlaceholderRange[] => {
  const ranges: PlaceholderRange[] = [];
  let remaining = maxLength;
  let offset = start;
  while (offset < end && remaining > 0) {
    while (offset < end && !visible(offset)) {
      offset++;
    }
    if (offset === end) {
      break;
    }
    const rangeStart = offset;
    while (offset < end && visible(offset) && remaining > 0) {
      offset++;
      remaining--;
    }
    ranges.push({ start: rangeStart, end: offset });
  }
  return ranges;
};

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
};

describe("SegmentedPlaceholderState differential", () => {
  it("matches a scalar prepare/effect model through mixed range mutations", () => {
    const length = 48;
    let nextSegmentId = 1;
    let nextOwnerId = 1;
    const state = new SegmentedPlaceholderState<SliceOwner>(
      length,
      "placeholder:0",
      () => `placeholder:${nextSegmentId++}`,
    );
    const initialSlice = state.createInitialPhysicalSlice();
    initialSlice.attachOwner({ id: "slice:0" });
    const slices: PlaceholderPhysicalSlice<SliceOwner>[] = [initialSlice];
    const cover = new Int32Array(length);
    const effectVisible = new Uint8Array(length).fill(1);
    const random = createRandom(0x5eed_c0de);

    const assertEquivalent = (): void => {
      const expectedPrepareLength = cover.reduce(
        (total, value) => total + (value === 0 ? 1 : 0),
        0,
      );
      const expectedEffectLength = effectVisible.reduce(
        (total, value) => total + value,
        0,
      );
      expect(state.prepareLength).toBe(expectedPrepareLength);
      expect(state.effectLength).toBe(expectedEffectLength);

      const logicalPrepare = new Int32Array(length);
      const logicalEffect = new Uint8Array(length);
      for (const segment of state.logicalSegments()) {
        for (let offset = segment.start; offset < segment.end; offset++) {
          logicalPrepare[offset] = segment.prepareState - 1;
          logicalEffect[offset] = segment.everDeleted ? 0 : 1;
        }
      }
      expect([...logicalPrepare]).toEqual([...cover]);
      expect([...logicalEffect]).toEqual([...effectVisible]);

      expect(state.collectPrepareVisibleRanges(0, length, length)).toEqual(
        collectRanges(0, length, (offset) => cover[offset] === 0),
      );
      expect(state.collectEffectVisibleRanges(0, length)).toEqual(
        collectRanges(0, length, (offset) => effectVisible[offset] === 1),
      );

      for (const slice of slices) {
        const visibleOffsets: number[] = [];
        let expectedEffect = 0;
        for (let offset = slice.start; offset < slice.end; offset++) {
          if (cover[offset] === 0) {
            visibleOffsets.push(offset);
          }
          expectedEffect += effectVisible[offset] ?? 0;
        }
        expect(slice.prepareLength).toBe(visibleOffsets.length);
        expect(slice.effectLength).toBe(expectedEffect);
        for (let rank = 0; rank < visibleOffsets.length; rank++) {
          expect(state.contentOffsetAtPrepareRank(slice, rank)).toBe(
            visibleOffsets[rank]! - slice.start,
          );
        }
        for (let rank = 0; rank <= visibleOffsets.length; rank++) {
          const expectedBoundary =
            rank === 0 ? 0 : visibleOffsets[rank - 1]! - slice.start + 1;
          expect(state.contentBoundaryAtPrepareRank(slice, rank)).toBe(
            expectedBoundary,
          );
        }
      }
    };

    for (let step = 0; step < 250; step++) {
      const operation = random() % 4;
      if (operation === 3) {
        const splittable = slices.filter((slice) => slice.length > 1);
        if (splittable.length > 0) {
          const selected = splittable[random() % splittable.length]!;
          const localOffset = 1 + (random() % (selected.length - 1));
          const right = state.splitPhysicalSlice(selected, localOffset);
          right.attachOwner({ id: `slice:${nextOwnerId++}` });
          slices.push(right);
          slices.sort((left, candidate) => left.start - candidate.start);
        }
        assertEquivalent();
        continue;
      }

      let start = random() % length;
      let end = start + 1 + (random() % (length - start));
      if (operation === 1) {
        const positiveOffsets = Array.from(
          { length },
          (_, offset) => offset,
        ).filter((offset) => cover[offset]! > 0);
        if (positiveOffsets.length === 0) {
          assertEquivalent();
          continue;
        }
        start = positiveOffsets[random() % positiveOffsets.length]!;
        end = start + 1;
        while (end < length && cover[end]! > 0 && random() % 3 !== 0) {
          end++;
        }
        state.adjustPrepareRange(start, end, -1);
        for (let offset = start; offset < end; offset++) {
          cover[offset]!--;
        }
      } else if (operation === 2) {
        state.adjustPrepareRange(start, end, 1);
        for (let offset = start; offset < end; offset++) {
          cover[offset]!++;
        }
      } else {
        const maximum = 1 + (random() % (end - start));
        const ranges = collectRanges(
          start,
          end,
          (offset) => cover[offset] === 0,
          maximum,
        );
        expect(state.deletePrepareVisible(start, end, maximum).ranges).toEqual(
          ranges,
        );
        for (const range of ranges) {
          for (let offset = range.start; offset < range.end; offset++) {
            cover[offset]!++;
            effectVisible[offset] = 0;
          }
        }
      }
      assertEquivalent();
    }
  });
});
