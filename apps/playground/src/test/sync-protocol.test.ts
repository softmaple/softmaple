import {
  EgWalkerReplica,
  type GraphEvent,
  OPERATION_TYPE,
  type SerializedGraphEventOutput,
} from "@softmaple/eg-walker";
import { describe, expect, it } from "vitest";

import {
  createSyncState,
  decodeWireEvents,
  encodeWireEvent,
  selectMissingWireEvents,
} from "../modules/collab-editor/sync-protocol";

const event = (
  id: string,
  parents: ReadonlyArray<string>,
  index: number,
  text: string,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: OPERATION_TYPE.INSERT, index, text },
  timestamp: Number(id.split(":").at(-1) ?? 0),
});

describe("collab sync protocol", () => {
  it("round-trips events through JSON without losing parents", () => {
    const original = event("merge:2", ["left:1", "right:1"], 2, "x");

    const parsed = JSON.parse(
      JSON.stringify(encodeWireEvent(original)),
    ) as SerializedGraphEventOutput;
    const [decoded] = decodeWireEvents([parsed]);

    expect(decoded).toEqual(original);
    expect(decoded?.parentVersion).toEqual(new Set(["left:1", "right:1"]));
  });

  it("computes a branched frontier and full known-ID causal state", () => {
    const root = event("root:0", [], 0, "r");
    const left = event("left:0", [root.id], 1, "l");
    const right = event("right:0", [root.id], 1, "r");

    expect(createSyncState([root, left, right])).toEqual({
      frontier: [left.id, right.id],
      knownEventIds: [root.id, left.id, right.id],
    });
  });

  it("exchanges a missing branch even when peers have equal event counts", () => {
    const root = event("root:0", [], 0, "r");
    const left = event("left:0", [root.id], 1, "l");
    const right = event("right:0", [root.id], 1, "r");

    const missing = selectMissingWireEvents(
      [root, left],
      createSyncState([root, right]).knownEventIds,
    );

    expect(missing.map((candidate) => candidate.id)).toEqual([left.id]);
  });

  it("keeps response events parent-before-child", () => {
    const root = event("root:0", [], 0, "r");
    const child = event("child:0", [root.id], 1, "c");

    expect(
      selectMissingWireEvents([root, child], []).map(
        (candidate) => candidate.id,
      ),
    ).toEqual([root.id, child.id]);
  });

  it("decodes a whole response before atomically applying any prefix", () => {
    const replica = new EgWalkerReplica("receiver");
    const valid = encodeWireEvent(event("root:0", [], 0, "r"));
    const malformed = {
      ...encodeWireEvent(event("child:0", ["root:0"], 1, "c")),
      parentVersion: new Set(["root:0"]),
    } as unknown as SerializedGraphEventOutput;

    expect(() =>
      replica.applyRemoteEvents(decodeWireEvents([valid, malformed])),
    ).toThrow(/parentVersion must be an array/);
    expect(replica.exportEventGraph()).toEqual([]);
    expect(replica.getText()).toBe("");
  });
});
