import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
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
