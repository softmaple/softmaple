import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import {
  planPackedCriticalReplaySections,
  type PackedCriticalReplayPlan,
} from "../engine/packed-critical-replay-plan";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import { TransientUtf16RopeEditor } from "../text/transient-utf16-rope";
import type { EventId, GraphEvent } from "../types";

interface PackedLinearReplayHarness {
  replayCoalescedPackedLinearSections(
    plan: PackedCriticalReplayPlan,
    startSection: number,
    endSection: number,
  ): void;
}

const pack = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(EventGraph.fromEvents(events)));
};

describe("transient packed linear replay", () => {
  it("freezes checkpoint-free long linear bridges without changing replay text", () => {
    const events: GraphEvent[] = [];
    let parents: EventId[] = [];
    let timestamp = 0;
    for (let layer = 0; layer < 40; layer++) {
      const left = `left:${layer}`;
      const right = `right:${layer}`;
      const merge = `merge:${layer}`;
      events.push(
        {
          id: left,
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "L" },
          parentVersion: new Set(parents),
          timestamp: timestamp++,
        },
        {
          id: right,
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "R" },
          parentVersion: new Set(parents),
          timestamp: timestamp++,
        },
        {
          id: merge,
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "m" },
          parentVersion: new Set([left, right]),
          timestamp: timestamp++,
        },
      );
      let parent = merge;
      for (let gap = 0; gap < 24; gap++) {
        const id = `gap:${layer}:${gap}`;
        events.push({
          id,
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "g" },
          parentVersion: new Set([parent]),
          timestamp: timestamp++,
        });
        parent = id;
      }
      parents = [parent];
    }

    const source = EventGraph.fromEvents(events);
    const order = source.getBranchPreservingTopologicalOrder();
    const expected = new EgWalkerEngine().generate(order, "", {
      eventGraph: source,
      eventOrder: order,
    }).text;
    const finish = vi.spyOn(TransientUtf16RopeEditor.prototype, "finish");

    const replica = new EgWalkerReplica(
      "transient-packed-bridges",
      "",
      pack(events),
    );

    expect(replica.getText()).toBe(expected);
    expect(finish).toHaveBeenCalled();
    expect(replica.getReplayStats().checkpointCount).toBe(32);
    finish.mockRestore();
  });

  it("validates surrogate boundaries against the transient document", () => {
    const graph = pack([
      {
        id: "append",
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "x" },
        parentVersion: new Set(),
        timestamp: 0,
      },
      {
        id: "mid-surrogate",
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "y" },
        parentVersion: new Set(["append"]),
        timestamp: 1,
      },
    ]);
    const plan = planPackedCriticalReplaySections(graph)!;
    const replica = new EgWalkerReplica("transient-surrogate", "🙂");
    const harness = replica as unknown as PackedLinearReplayHarness;
    const finish = vi.spyOn(TransientUtf16RopeEditor.prototype, "finish");

    expect(() =>
      harness.replayCoalescedPackedLinearSections(plan, 0, plan.sectionCount),
    ).toThrow(/between surrogate halves/);
    expect(finish).not.toHaveBeenCalled();
    expect(replica.getText()).toBe("🙂");
    expect(replica.serialize().eventGraph.version).toEqual([]);
    finish.mockRestore();
  });

  it("commits a valid UTF-16 series only at its persistent boundary", () => {
    const graph = pack([
      {
        id: "append",
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "x" },
        parentVersion: new Set(),
        timestamp: 0,
      },
      {
        id: "remove-emoji",
        operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 2 },
        parentVersion: new Set(["append"]),
        timestamp: 1,
      },
    ]);
    const plan = planPackedCriticalReplaySections(graph)!;
    const replica = new EgWalkerReplica("transient-valid-surrogate", "🙂");
    const harness = replica as unknown as PackedLinearReplayHarness;

    harness.replayCoalescedPackedLinearSections(plan, 0, plan.sectionCount);

    expect(replica.getText()).toBe("x");
  });
});
