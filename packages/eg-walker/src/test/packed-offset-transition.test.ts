import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { planPackedCriticalReplaySections } from "../engine/packed-critical-replay-plan";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import {
  PackedDiffVersionsWorkspace,
  type PackedLocalVersionTransition,
} from "../graph/internals/packed-diff-versions";
import type { EventId, GraphEvent } from "../types";

const insert = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  timestamp: number,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: OPERATION_TYPE.INSERT, index: 0, text: id },
  timestamp,
});

const pack = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(EventGraph.fromEvents(events)));
};

const transitionIds = (
  offsets: Uint32Array,
  count: number,
  idAt: (offset: number) => EventId | undefined,
): EventId[] => {
  const ids = new Array<EventId>(count);
  for (let index = 0; index < count; index++) {
    const id = idAt(offsets[index]!);
    if (id === undefined) {
      throw new Error(`Missing test event at offset ${offsets[index]}`);
    }
    ids[index] = id;
  }
  return ids;
};

const expandRangeTransition = (
  transition: PackedLocalVersionTransition,
): { retreat: number[]; advance: number[] } => {
  const retreat: number[] = [];
  for (let range = 0; range < transition.retreatRangeCount; range++) {
    for (
      let offset = transition.retreatEnds[range]! - 1;
      offset >= transition.retreatStarts[range]!;
      offset--
    ) {
      retreat.push(offset);
    }
  }

  const advance: number[] = [];
  for (let range = 0; range < transition.advanceRangeCount; range++) {
    for (
      let offset = transition.advanceStarts[range]!;
      offset < transition.advanceEnds[range]!;
      offset++
    ) {
      advance.push(offset);
    }
  }
  return { retreat, advance };
};

describe("packed offset transitions", () => {
  const events = [
    insert("0-root", [], 0),
    insert("1-a", ["0-root"], 1),
    insert("2-b", ["0-root"], 2),
    insert("3-c", ["0-root"], 3),
    insert("4-d", ["0-root"], 4),
    insert("5-target", ["3-c", "4-d"], 5),
  ];

  it("returns reusable offset buffers in retreat and advance order", () => {
    const view = pack(events).getPackedReplayPlanningView()!;
    const targetOffset = view.offsetOf("5-target")!;

    const transition = view.diffVersionToParents(
      new Set(["1-a", "2-b"]),
      targetOffset,
    );

    expect(
      transitionIds(
        transition.retreatOffsets,
        transition.retreatCount,
        (offset) => view.idAt(offset),
      ),
    ).toEqual(["2-b", "1-a"]);
    expect(
      transitionIds(
        transition.advanceOffsets,
        transition.advanceCount,
        (offset) => view.idAt(offset),
      ),
    ).toEqual(["3-c", "4-d"]);

    const next = view.diffOffsetToParents(view.offsetOf("1-a")!, targetOffset);
    expect(next).toBe(transition);
    expect(
      transitionIds(next.retreatOffsets, next.retreatCount, (offset) =>
        view.idAt(offset),
      ),
    ).toEqual(["1-a"]);
    expect(
      transitionIds(next.advanceOffsets, next.advanceCount, (offset) =>
        view.idAt(offset),
      ),
    ).toEqual(["3-c", "4-d"]);
  });

  it("uses an optional branch-preserving rank without sorting results", () => {
    const view = pack(events).getPackedReplayPlanningView()!;
    const rankByOffset = new Uint32Array(view.count);
    for (let offset = 0; offset < view.count; offset++) {
      rankByOffset[offset] = offset;
    }
    rankByOffset[view.offsetOf("2-b")!] = 1;
    rankByOffset[view.offsetOf("1-a")!] = 2;
    rankByOffset[view.offsetOf("4-d")!] = 3;
    rankByOffset[view.offsetOf("3-c")!] = 4;

    const transition = view.diffVersionToParents(
      new Set(["1-a", "2-b"]),
      view.offsetOf("5-target")!,
      rankByOffset,
    );

    expect(
      transitionIds(
        transition.retreatOffsets,
        transition.retreatCount,
        (offset) => view.idAt(offset),
      ),
    ).toEqual(["1-a", "2-b"]);
    expect(
      transitionIds(
        transition.advanceOffsets,
        transition.advanceCount,
        (offset) => view.idAt(offset),
      ),
    ).toEqual(["4-d", "3-c"]);
  });

  it("compresses contiguous local versions without changing scalar order", () => {
    const view = pack(events).getPackedReplayPlanningView()!;
    const targetOffset = view.offsetOf("5-target")!;
    const expected = view.diffVersionToParents(
      new Set(["1-a", "2-b"]),
      targetOffset,
    );
    const expectedRetreat = Array.from(
      expected.retreatOffsets.subarray(0, expected.retreatCount),
    );
    const expectedAdvance = Array.from(
      expected.advanceOffsets.subarray(0, expected.advanceCount),
    );

    const transition = view.diffVersionToParentRanges(
      new Set(["1-a", "2-b"]),
      targetOffset,
    );

    expect(transition.retreatRangeCount).toBe(1);
    expect(transition.retreatEventCount).toBe(expectedRetreat.length);
    expect(transition.advanceRangeCount).toBe(1);
    expect(transition.advanceEventCount).toBe(expectedAdvance.length);
    expect(expandRangeTransition(transition)).toEqual({
      retreat: expectedRetreat,
      advance: expectedAdvance,
    });

    const next = view.diffOffsetToParentRanges(
      view.offsetOf("1-a")!,
      targetOffset,
    );
    expect(next).toBe(transition);
    expect(expandRangeTransition(next)).toEqual({
      retreat: [view.offsetOf("1-a")!],
      advance: [view.offsetOf("3-c")!, view.offsetOf("4-d")!],
    });
  });

  it("collects ranges without writing scalar transition offsets", () => {
    const view = pack(events).getPackedReplayPlanningView()!;
    const targetOffset = view.offsetOf("5-target")!;
    const workspace = new PackedDiffVersionsWorkspace(view.count);

    const transition = workspace.diffVersionToParentRanges(
      new Set(["1-a", "2-b"]),
      targetOffset,
      view,
    );

    expect(workspace.scalarOffsetWriteCount).toBe(0);
    expect(workspace.retreatCount).toBe(0);
    expect(workspace.advanceCount).toBe(0);
    expect(expandRangeTransition(transition)).toEqual({
      retreat: [view.offsetOf("2-b")!, view.offsetOf("1-a")!],
      advance: [view.offsetOf("3-c")!, view.offsetOf("4-d")!],
    });

    const scalar = workspace.diffVersionToParents(
      new Set(["1-a", "2-b"]),
      targetOffset,
      view,
    );
    expect(workspace.scalarOffsetWriteCount).toBe(
      scalar.retreatCount + scalar.advanceCount,
    );
  });

  it("preserves ranked scalar order when adjacent offsets cannot merge", () => {
    const view = pack(events).getPackedReplayPlanningView()!;
    const targetOffset = view.offsetOf("5-target")!;
    const rankByOffset = new Uint32Array(view.count);
    for (let offset = 0; offset < view.count; offset++) {
      rankByOffset[offset] = offset;
    }
    rankByOffset[view.offsetOf("2-b")!] = 1;
    rankByOffset[view.offsetOf("1-a")!] = 2;
    rankByOffset[view.offsetOf("4-d")!] = 3;
    rankByOffset[view.offsetOf("3-c")!] = 4;

    const expected = view.diffVersionToParents(
      new Set(["1-a", "2-b"]),
      targetOffset,
      rankByOffset,
    );
    const expectedRetreat = Array.from(
      expected.retreatOffsets.subarray(0, expected.retreatCount),
    );
    const expectedAdvance = Array.from(
      expected.advanceOffsets.subarray(0, expected.advanceCount),
    );
    const transition = view.diffVersionToParentRanges(
      new Set(["1-a", "2-b"]),
      targetOffset,
      rankByOffset,
    );

    expect(transition.retreatRangeCount).toBe(2);
    expect(transition.advanceRangeCount).toBe(2);
    expect(expandRangeTransition(transition)).toEqual({
      retreat: expectedRetreat,
      advance: expectedAdvance,
    });
  });

  it("resets its reusable workspace after invalid replay ranks", () => {
    const view = pack(events).getPackedReplayPlanningView()!;
    const targetOffset = view.offsetOf("5-target")!;

    expect(() =>
      view.diffVersionToParents(
        new Set(["1-a"]),
        targetOffset,
        new Uint32Array(view.count - 1),
      ),
    ).toThrow("does not match event count");

    const transition = view.diffVersionToParents(
      new Set(["1-a"]),
      targetOffset,
    );
    expect(
      transitionIds(
        transition.retreatOffsets,
        transition.retreatCount,
        (offset) => view.idAt(offset),
      ),
    ).toEqual(["1-a"]);
    expect(
      transitionIds(
        transition.advanceOffsets,
        transition.advanceCount,
        (offset) => view.idAt(offset),
      ),
    ).toEqual(["3-c", "4-d"]);
  });

  it("exposes range transitions through the packed replay plan", () => {
    const graph = pack(events);
    const view = graph.getPackedReplayPlanningView()!;
    const plan = planPackedCriticalReplaySections(graph)!;
    const targetOffset = view.offsetOf("5-target")!;
    const currentVersion = new Set<EventId>(["1-a", "2-b"]);
    const expected = plan.transitionFromVersionToKnownOffset(
      currentVersion,
      targetOffset,
    );
    const expectedRetreat = Array.from(
      expected.retreatOffsets.subarray(0, expected.retreatCount),
    );
    const expectedAdvance = Array.from(
      expected.advanceOffsets.subarray(0, expected.advanceCount),
    );

    const transition = plan.transitionRangesFromVersionToKnownOffset(
      currentVersion,
      targetOffset,
    );
    expect(expandRangeTransition(transition)).toEqual({
      retreat: expectedRetreat,
      advance: expectedAdvance,
    });

    const currentOffset = view.offsetOf("1-a")!;
    const expectedNext = plan.transitionBetweenKnownOffsets(
      currentOffset,
      targetOffset,
    );
    const expectedNextRetreat = Array.from(
      expectedNext.retreatOffsets.subarray(0, expectedNext.retreatCount),
    );
    const expectedNextAdvance = Array.from(
      expectedNext.advanceOffsets.subarray(0, expectedNext.advanceCount),
    );
    const next = plan.transitionRangesBetweenKnownOffsets(
      currentOffset,
      targetOffset,
    );
    expect(expandRangeTransition(next)).toEqual({
      retreat: expectedNextRetreat,
      advance: expectedNextAdvance,
    });
  });
});

describe("EventGraph.isInsertEvent", () => {
  it("reads object, packed, and mutable-tail operations without cloning", () => {
    const source = EventGraph.fromEvents([
      insert("root", [], 0),
      {
        id: "delete",
        parentVersion: new Set(["root"]),
        operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
        timestamp: 1,
      },
    ]);
    const sourceGetEvent = vi.spyOn(source, "getEvent");

    expect(source.isInsertEvent("root")).toBe(true);
    expect(source.isInsertEvent("delete")).toBe(false);
    expect(source.isInsertEvent("missing")).toBeUndefined();
    expect(sourceGetEvent).not.toHaveBeenCalled();

    const packed = pack(source.getAllEvents());
    const packedGetEvent = vi.spyOn(packed, "getEvent");
    expect(packed.isInsertEvent("root")).toBe(true);
    expect(packed.isInsertEvent("delete")).toBe(false);
    expect(packed.isInsertEvent("missing")).toBeUndefined();

    packed.addEvent({
      id: "tail",
      parentVersion: new Set(["delete"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "t" },
      timestamp: 2,
    });
    expect(packed.isInsertEvent("tail")).toBe(true);
    expect(packedGetEvent).not.toHaveBeenCalled();
  });
});
