import { describe, expect, it } from "vitest";

import {
  PACKED_EULER_BOUNDARY,
  PackedEulerRankIndex,
  type PackedEulerBoundary,
} from "../engine/internals/packed-euler-rank-index";
import { createPrng } from "./test-helpers";

const BOUNDARIES = [
  PACKED_EULER_BOUNDARY.Start,
  PACKED_EULER_BOUNDARY.Visit,
  PACKED_EULER_BOUNDARY.End,
] as const;

const markerId = (node: number, boundary: PackedEulerBoundary): number =>
  node * 3 + boundary;

const markerVisitWeight = (marker: number): number =>
  marker !== PACKED_EULER_BOUNDARY.Visit &&
  marker % 3 === PACKED_EULER_BOUNDARY.Visit
    ? 1
    : 0;

const modelRankBefore = (
  markers: ReadonlyArray<number>,
  markerIndex: number,
): number => {
  let rank = 0;
  for (let index = 0; index < markerIndex; index++) {
    rank += markerVisitWeight(markers[index]!);
  }
  return rank;
};

const modelVisitRank = (
  markers: ReadonlyArray<number>,
  node: number,
): number => {
  const visitIndex = markers.indexOf(
    markerId(node, PACKED_EULER_BOUNDARY.Visit),
  );
  if (visitIndex < 0) {
    throw new Error(`Model node ${node} is unavailable`);
  }
  return modelRankBefore(markers, visitIndex);
};

const modelInsertNodeBefore = (
  markers: number[],
  targetNode: number,
  targetBoundary: PackedEulerBoundary,
  node: number,
): number => {
  const targetIndex = markers.indexOf(markerId(targetNode, targetBoundary));
  if (targetIndex < 0) {
    throw new Error(`Model target ${targetNode}:${targetBoundary} is missing`);
  }
  const rank = modelRankBefore(markers, targetIndex);
  markers.splice(
    targetIndex,
    0,
    markerId(node, PACKED_EULER_BOUNDARY.Start),
    markerId(node, PACKED_EULER_BOUNDARY.Visit),
    markerId(node, PACKED_EULER_BOUNDARY.End),
  );
  return rank;
};

const modelInsertSplitContinuation = (
  markers: number[],
  leftNode: number,
  rightNode: number,
): number => {
  const leftVisit = markerId(leftNode, PACKED_EULER_BOUNDARY.Visit);
  const leftVisitIndex = markers.indexOf(leftVisit);
  if (leftVisitIndex < 0) {
    throw new Error(`Model split node ${leftNode} is missing`);
  }
  const rank = modelRankBefore(markers, leftVisitIndex) + 1;
  markers.splice(
    leftVisitIndex + 1,
    0,
    markerId(rightNode, PACKED_EULER_BOUNDARY.Start),
    markerId(rightNode, PACKED_EULER_BOUNDARY.Visit),
  );

  const leftEndIndex = markers.indexOf(
    markerId(leftNode, PACKED_EULER_BOUNDARY.End),
  );
  if (leftEndIndex < 0) {
    throw new Error(`Model split end ${leftNode} is missing`);
  }
  markers.splice(
    leftEndIndex,
    0,
    markerId(rightNode, PACKED_EULER_BOUNDARY.End),
  );
  return rank;
};

describe("PackedEulerRankIndex", () => {
  it("matches an array model across anchored inserts and continuation splits", () => {
    const index = new PackedEulerRankIndex();
    const model = [0, 1, 2];
    const insertedNodes = [0];
    const random = createPrng(0xe013_2026);

    for (let step = 0; step < 2_500; step++) {
      const node = index.allocateNode();
      expect(node).toBe(insertedNodes.length);

      if (insertedNodes.length > 1 && random() < 0.28) {
        const leftNode =
          insertedNodes[1 + Math.floor(random() * (insertedNodes.length - 1))]!;
        const expectedRank = modelInsertSplitContinuation(
          model,
          leftNode,
          node,
        );
        index.insertSplitContinuation(leftNode, node);
        expect(index.rankOfVisit(node)).toBe(expectedRank);
      } else {
        const targetNode =
          insertedNodes[Math.floor(random() * insertedNodes.length)]!;
        const boundary = BOUNDARIES[Math.floor(random() * BOUNDARIES.length)]!;
        const expectedRank = modelInsertNodeBefore(
          model,
          targetNode,
          boundary,
          node,
        );
        expect(index.insertNodeBefore(targetNode, boundary, node)).toBe(
          expectedRank,
        );
      }
      insertedNodes.push(node);

      if (step % 73 === 0) {
        expect(index.getMarkerOrder()).toEqual(model);
        for (let probe = 0; probe < 12; probe++) {
          const target =
            insertedNodes[Math.floor(random() * insertedNodes.length)]!;
          expect(index.rankOfVisit(target)).toBe(modelVisitRank(model, target));
        }
      }
    }

    expect(index.getMarkerOrder()).toEqual(model);
    for (const node of insertedNodes) {
      expect(index.rankOfVisit(node)).toBe(modelVisitRank(model, node));
    }
  });

  it("keeps stable handles through repeated splits of the same continuation", () => {
    const index = new PackedEulerRankIndex();
    const model = [0, 1, 2];
    const leftNode = index.allocateNode();
    expect(index.insertNodeBefore(0, PACKED_EULER_BOUNDARY.End, leftNode)).toBe(
      modelInsertNodeBefore(model, 0, PACKED_EULER_BOUNDARY.End, leftNode),
    );

    for (let step = 0; step < 512; step++) {
      const rightNode = index.allocateNode();
      const expectedRank = modelInsertSplitContinuation(
        model,
        leftNode,
        rightNode,
      );
      index.insertSplitContinuation(leftNode, rightNode);
      expect(index.rankOfVisit(rightNode)).toBe(expectedRank);
    }

    expect(index.getMarkerOrder()).toEqual(model);
  });

  it("skips the rank walk when the caller already knows the position", () => {
    const ranked = new PackedEulerRankIndex();
    const unranked = new PackedEulerRankIndex();
    for (let step = 0; step < 256; step++) {
      const rankedNode = ranked.allocateNode();
      const unrankedNode = unranked.allocateNode();
      ranked.insertNodeBefore(0, PACKED_EULER_BOUNDARY.End, rankedNode);
      unranked.insertNodeBeforeUnranked(
        0,
        PACKED_EULER_BOUNDARY.End,
        unrankedNode,
      );
    }

    expect(unranked.getMarkerOrder()).toEqual(ranked.getMarkerOrder());
    expect(unranked.getStructuralOperationCount()).toBeLessThan(
      ranked.getStructuralOperationCount(),
    );
  });

  it("resets marker locations, handles, and structural counters", () => {
    const index = new PackedEulerRankIndex();
    for (let step = 0; step < 400; step++) {
      const node = index.allocateNode();
      index.insertNodeBefore(0, PACKED_EULER_BOUNDARY.Visit, node);
    }
    expect(index.getStructuralOperationCount()).toBeGreaterThan(0);

    index.restoreStructuralOperationCount(12_345);
    expect(index.getStructuralOperationCount()).toBe(12_345);
    expect(index.reset()).toBe(0);
    expect(index.getStructuralOperationCount()).toBe(0);
    expect(index.getMarkerOrder()).toEqual([0, 1, 2]);

    const node = index.allocateNode();
    expect(node).toBe(1);
    expect(index.insertNodeBefore(0, PACKED_EULER_BOUNDARY.Visit, node)).toBe(
      0,
    );
    expect(index.rankOfVisit(node)).toBe(0);
  });

  it("keeps deterministic logarithmic structural growth", () => {
    const sizes = [400, 800, 1_600] as const;
    const measurements = sizes.map((size) => {
      const index = new PackedEulerRankIndex();
      for (let step = 0; step < size; step++) {
        const node = index.allocateNode();
        // Repeated insertion at one dense boundary exercises bounded leaf
        // shifts and deterministic leaf/internal splits.
        index.insertNodeBefore(0, PACKED_EULER_BOUNDARY.Visit, node);
      }
      return { size, work: index.getStructuralOperationCount() };
    });

    for (const measurement of measurements) {
      expect(measurement.work).toBeLessThan(
        measurement.size * Math.ceil(Math.log2(measurement.size)) * 80,
      );
    }
    expect(measurements[1]!.work / measurements[0]!.work).toBeLessThan(2.75);
    expect(measurements[2]!.work / measurements[1]!.work).toBeLessThan(2.75);
  });

  it("rejects unavailable and duplicate handles without changing marker order", () => {
    const index = new PackedEulerRankIndex();
    const node = index.allocateNode();
    index.insertNodeBefore(0, PACKED_EULER_BOUNDARY.End, node);
    const before = index.getMarkerOrder();

    expect(() =>
      index.insertNodeBefore(0, PACKED_EULER_BOUNDARY.End, node),
    ).toThrow(/in use/);
    expect(() =>
      index.insertNodeBefore(
        999,
        PACKED_EULER_BOUNDARY.End,
        index.allocateNode(),
      ),
    ).toThrow(/unavailable/);
    expect(() =>
      index.insertSplitContinuation(0, index.allocateNode()),
    ).toThrow(/synthetic Euler root/);
    expect(index.getMarkerOrder()).toEqual(before);
  });
});
