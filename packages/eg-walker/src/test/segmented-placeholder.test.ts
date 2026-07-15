import { describe, expect, it } from "vitest";
import {
  PlaceholderPhysicalSlice,
  SegmentedPlaceholderState,
} from "../engine/internals/segmented-placeholder";

interface SliceOwner {
  readonly id: string;
}

const createState = (length: number) => {
  let nextId = 1;
  const state = new SegmentedPlaceholderState<SliceOwner>(
    length,
    "placeholder:0",
    () => `placeholder:${nextId++}`,
  );
  return { state, allocations: () => nextId };
};

describe("SegmentedPlaceholderState", () => {
  it("tracks overlapping prepare coverage independently from permanent effect deletion", () => {
    const { state } = createState(12);
    const slice = state.createInitialPhysicalSlice();
    slice.attachOwner({ id: "root" });

    state.applyDeleteRange(2, 8);
    state.applyDeleteRange(4, 6);

    expect(state.prepareLength).toBe(6);
    expect(state.effectLength).toBe(6);
    expect(slice.prepareLength).toBe(6);
    expect(slice.effectLength).toBe(6);
    expect(state.logicalSegments()).toEqual([
      {
        id: "placeholder:0",
        start: 0,
        end: 2,
        prepareState: 1,
        everDeleted: false,
      },
      {
        id: "placeholder:1",
        start: 2,
        end: 4,
        prepareState: 2,
        everDeleted: true,
      },
      {
        id: "placeholder:3",
        start: 4,
        end: 6,
        prepareState: 3,
        everDeleted: true,
      },
      {
        id: "placeholder:4",
        start: 6,
        end: 8,
        prepareState: 2,
        everDeleted: true,
      },
      {
        id: "placeholder:2",
        start: 8,
        end: 12,
        prepareState: 1,
        everDeleted: false,
      },
    ]);

    state.adjustPrepareRange(2, 8, -1);
    expect(state.prepareLength).toBe(10);
    expect(state.effectLength).toBe(6);
    expect(state.collectPrepareVisibleRanges(0, 12, 12)).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 12 },
    ]);

    state.adjustPrepareRange(4, 6, -1);
    expect(state.prepareLength).toBe(12);
    expect(state.effectLength).toBe(6);

    state.adjustPrepareRange(2, 8, 1);
    state.adjustPrepareRange(4, 6, 1);
    expect(state.prepareLength).toBe(6);
    expect(state.effectLength).toBe(6);
  });

  it("maps visible code units and insertion boundaries across deleted gaps", () => {
    const { state } = createState(10);
    const slice = state.createInitialPhysicalSlice();
    slice.attachOwner({ id: "root" });
    state.applyDeleteRange(2, 4);
    state.applyDeleteRange(6, 8);

    expect(slice.prepareLength).toBe(6);
    expect(
      Array.from({ length: slice.prepareLength }, (_, rank) =>
        state.contentOffsetAtPrepareRank(slice, rank),
      ),
    ).toEqual([0, 1, 4, 5, 8, 9]);
    expect(
      Array.from({ length: slice.prepareLength + 1 }, (_, rank) =>
        state.contentBoundaryAtPrepareRank(slice, rank),
      ),
    ).toEqual([0, 1, 2, 5, 6, 9, 10]);

    expect(state.collectPrepareVisibleRanges(1, 10, 4)).toEqual([
      { start: 1, end: 2 },
      { start: 4, end: 6 },
      { start: 8, end: 9 },
    ]);
    expect(state.collectEffectVisibleRanges(0, 10)).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 6 },
      { start: 8, end: 10 },
    ]);
  });

  it("deletes only prepare-visible ranges and preserves their targets for retreat", () => {
    const { state } = createState(10);
    const slice = state.createInitialPhysicalSlice();
    slice.attachOwner({ id: "root" });
    state.applyDeleteRange(2, 4);
    state.applyDeleteRange(6, 8);

    const result = state.deletePrepareVisible(0, 10, 4);
    expect(result.ranges).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 6 },
    ]);
    expect(result.deletedEffectLength).toBe(4);
    expect(result.affectedSlices).toEqual([slice]);
    expect(state.prepareLength).toBe(2);
    expect(state.effectLength).toBe(2);

    for (const range of result.ranges) {
      state.adjustPrepareRange(range.start, range.end, -1);
    }
    expect(state.prepareLength).toBe(6);
    // Retreat changes only the prepare view. Effect-deleted content stays out.
    expect(state.effectLength).toBe(2);
  });

  it("shares logical state across indexed physical slices", () => {
    const { state } = createState(12);
    const left = state.createInitialPhysicalSlice();
    left.attachOwner({ id: "left" });
    state.applyDeleteRange(2, 6);

    const middle = state.splitPhysicalSlice(left, 4);
    middle.attachOwner({ id: "middle" });
    const right = state.splitPhysicalSlice(middle, 5);
    right.attachOwner({ id: "right" });

    expect(
      [left, middle, right].map((slice) => ({
        owner: slice.owner?.id,
        range: [slice.start, slice.end],
        prepare: slice.prepareLength,
        effect: slice.effectLength,
      })),
    ).toEqual([
      { owner: "left", range: [0, 4], prepare: 2, effect: 2 },
      { owner: "middle", range: [4, 9], prepare: 3, effect: 3 },
      { owner: "right", range: [9, 12], prepare: 3, effect: 3 },
    ]);
    expect(state.slicesOverlapping(3, 10)).toEqual([left, middle, right]);

    const boundaryId = state.segmentIdAtBoundary(4);
    expect(state.segmentIdAtBoundary(4)).toBe(boundaryId);
    expect(state.physicalSliceCount).toBe(3);
  });

  it("uses lazy whole-range updates and rejects negative prepare coverage", () => {
    const { state, allocations } = createState(32);
    const slice = state.createInitialPhysicalSlice();
    slice.attachOwner({ id: "root" });

    state.applyDeleteRange(0, 32);
    expect(state.logicalSegmentCount).toBe(1);
    expect(state.prepareLength).toBe(0);
    expect(state.effectLength).toBe(0);

    state.adjustPrepareRange(0, 32, -1);
    expect(state.prepareLength).toBe(32);
    expect(state.effectLength).toBe(0);
    expect(() => state.adjustPrepareRange(3, 7, -1)).toThrow(
      "would become negative",
    );
    // Validation happens before splitting, so a rejected transition consumes
    // no logical IDs and leaves the state unchanged.
    expect(allocations()).toBe(1);
    expect(state.logicalSegmentCount).toBe(1);
    expect(state.prepareLength).toBe(32);
  });

  it("keeps physical-slice overlap lookup logarithmic plus output size", () => {
    const { state } = createState(256);
    let tail = state.createInitialPhysicalSlice();
    tail.attachOwner({ id: "0" });
    for (let index = 1; index < 256; index++) {
      tail = state.splitPhysicalSlice(tail, 1);
      tail.attachOwner({ id: `${index}` });
    }

    state.restoreStructuralOperationCount(0);
    expect(
      state.slicesOverlapping(255, 256).map((slice) => slice.owner?.id),
    ).toEqual(["255"]);
    expect(state.getStructuralOperationCount()).toBeLessThanOrEqual(10);
  });

  it("registers restored slices and balances ascending and descending ranges", () => {
    const { state } = createState(10);
    expect(state.slicesOverlapping(0, 10)).toEqual([]);

    const right = state.registerPhysicalSlice(6, 8);
    const left = state.registerPhysicalSlice(2, 4);
    const middle = state.registerPhysicalSlice(4, 6);
    state.registerPhysicalSlice(0, 2);
    state.registerPhysicalSlice(8, 10);

    expect(state.physicalSliceCount).toBe(5);
    expect(state.slicesOverlapping(3, 7)).toEqual([left, middle, right]);
    expect(state.logicalSegmentsInRange(2, 6)).toEqual([
      {
        id: "placeholder:0",
        start: 2,
        end: 6,
        prepareState: 1,
        everDeleted: false,
      },
    ]);
    expect(() => state.registerPhysicalSlice(3, 5)).toThrow(
      "physical slices overlap",
    );

    const reverse = createState(10).state;
    reverse.registerPhysicalSlice(0, 2);
    reverse.registerPhysicalSlice(6, 8);
    reverse.registerPhysicalSlice(4, 6);
    expect(reverse.physicalSliceCount).toBe(3);
  });

  it("rejects invalid ranges, ranks, slices, IDs, and cached weights", () => {
    expect(
      () => new SegmentedPlaceholderState(0, "placeholder:0", () => "next"),
    ).toThrow("Invalid placeholder length");
    expect(() => new SegmentedPlaceholderState(4, "", () => "next")).toThrow(
      "non-empty string",
    );

    const { state } = createState(4);
    const slice = state.createInitialPhysicalSlice();
    const owner = { id: "root" };
    slice.attachOwner(owner);
    slice.attachOwner(owner);

    expect(() => slice.attachOwner({ id: "other" })).toThrow("different owner");
    expect(() => state.createInitialPhysicalSlice()).toThrow("already exists");
    expect(() => state.restoreStructuralOperationCount(-1)).toThrow(
      "Invalid structural operation count",
    );
    expect(() => state.splitPhysicalSlice(slice, 0)).toThrow(
      "Invalid physical placeholder split",
    );
    expect(() => state.segmentIdAtBoundary(4)).toThrow(
      "Invalid logical placeholder boundary",
    );
    expect(state.segmentIdAtBoundary(0)).toBe("placeholder:0");
    expect(() => state.contentOffsetAtPrepareRank(slice, 4)).toThrow(
      "Invalid prepare rank",
    );
    expect(() => state.contentBoundaryAtPrepareRank(slice, 5)).toThrow(
      "Invalid prepare boundary rank",
    );
    expect(() => state.collectPrepareVisibleRanges(0, 4, -1)).toThrow(
      "Invalid maximum visible length",
    );
    expect(state.collectPrepareVisibleRanges(2, 2, 1)).toEqual([]);
    expect(() => state.applyDeleteRange(2, 2)).toThrow("is empty");
    expect(() => state.applyDeleteRange(-1, 2)).toThrow(
      "Invalid placeholder range",
    );
    expect(() => state.deletePrepareVisibleInSlice(slice, -1, 1)).toThrow(
      "Invalid placeholder delete offset",
    );
    expect(() => slice.adjustCachedLengths(-5, 0)).toThrow(
      "Invalid placeholder slice weights",
    );

    const foreign = createState(4).state.createInitialPhysicalSlice();
    expect(() => state.contentOffsetAtPrepareRank(foreign, 0)).toThrow(
      "belongs to a different state",
    );
    const unregistered = new PlaceholderPhysicalSlice(state, 1, 2);
    expect(() => state.contentOffsetAtPrepareRank(unregistered, 0)).toThrow(
      "is not registered",
    );

    const duplicate = new SegmentedPlaceholderState(
      4,
      "placeholder:0",
      () => "placeholder:0",
    );
    duplicate.createInitialPhysicalSlice();
    expect(() => duplicate.segmentIdAtBoundary(1)).toThrow(
      "Duplicate placeholder segment ID",
    );

    expect(() => slice.setEnd(0)).toThrow("Invalid placeholder slice end");
  });
});
