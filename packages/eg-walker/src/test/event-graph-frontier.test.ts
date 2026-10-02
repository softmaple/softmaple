import { describe, expect, it } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { EventGraph } from "../graph/event-graph";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import type { EventId, GraphEvent } from "../types";

const insertEvent = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  timestamp = 0,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
  timestamp,
});

/** Roots `root:0` … `root:<count - 1>`, each a frontier event. */
const wideGraph = (count: number): EventGraph => {
  const graph = new EventGraph();
  for (let index = 0; index < count; index++) {
    graph.addEvent(insertEvent(`root${index}:0`, [], index));
  }
  return graph;
};

describe("EventGraph frontier", () => {
  it("hands out one live frontier view that follows appends", () => {
    const graph = wideGraph(3);
    const view = graph.getFrontierView();
    expect([...view]).toEqual(["root0:0", "root1:0", "root2:0"]);
    expect(graph.getFrontierSize()).toBe(3);

    graph.addEvent(insertEvent("merge:0", ["root0:0", "root2:0"]));

    expect(graph.getFrontierView()).toBe(view);
    expect([...view]).toEqual(["root1:0", "merge:0"]);
    expect(graph.getFrontierSize()).toBe(2);
    expect(graph.getFrontier()).not.toBe(view);
    expect([...graph.getFrontier()]).toEqual([...view]);
  });

  it("returns isolated copies from getFrontier", () => {
    const graph = wideGraph(2);
    const copy = graph.getFrontier();
    copy.clear();
    graph.addEvent(insertEvent("next:0", ["root0:0"]));

    expect(copy.size).toBe(0);
    expect([...graph.getFrontier()]).toEqual(["root1:0", "next:0"]);
  });

  it("restores the frontier and its order when a rollback brings back parents", () => {
    const graph = wideGraph(4);
    const view = graph.getFrontierView();
    const before = [...graph.getFrontier()];

    const transaction = graph.beginAppendTransaction();
    graph.addEvent(insertEvent("a:0", ["root1:0", "root3:0"]));
    graph.addEvent(insertEvent("b:0", ["root0:0", "a:0"]));
    graph.addEvent(insertEvent("c:0", []));
    expect([...view]).toEqual(["root2:0", "b:0", "c:0"]);
    transaction.rollback();

    expect([...graph.getFrontier()]).toEqual(before);
    expect([...view]).toEqual(before);
    expect(graph.getFrontierSize()).toBe(4);
    expect(graph.getFrontierLocalVersions()).toEqual([0, 1, 2, 3]);
    expect(graph.getEventCount()).toBe(4);
  });

  it("keeps the frontier order of a rollback that only added events", () => {
    const graph = wideGraph(3);
    const before = [...graph.getFrontier()];

    const transaction = graph.beginAppendTransaction();
    graph.addEvent(insertEvent("d:0", []));
    graph.addEvent(insertEvent("e:0", ["d:0"]));
    transaction.rollback();

    expect([...graph.getFrontier()]).toEqual(before);
  });

  it("undoes a committed inner transaction when the outer one rolls back", () => {
    const graph = wideGraph(3);
    const before = [...graph.getFrontier()];

    const outer = graph.beginAppendTransaction();
    graph.addEvent(insertEvent("a:0", ["root0:0"]));
    const inner = graph.beginAppendTransaction();
    graph.addEvent(insertEvent("b:0", ["a:0", "root2:0"]));
    inner.commit();
    expect([...graph.getFrontier()]).toEqual(["root1:0", "b:0"]);
    outer.rollback();

    expect([...graph.getFrontier()]).toEqual(before);
    expect(graph.getEventCount()).toBe(3);
  });

  it("rolls back only the inner transaction's frontier changes", () => {
    const graph = wideGraph(2);

    const outer = graph.beginAppendTransaction();
    graph.addEvent(insertEvent("a:0", ["root0:0"]));
    const inner = graph.beginAppendTransaction();
    graph.addEvent(insertEvent("b:0", ["a:0", "root1:0"]));
    inner.rollback();
    expect([...graph.getFrontier()]).toEqual(["root1:0", "a:0"]);
    outer.commit();

    // A later transaction starts from the committed frontier.
    const later = graph.beginAppendTransaction();
    graph.addEvent(insertEvent("c:0", ["root1:0", "a:0"]));
    later.rollback();
    expect([...graph.getFrontier()]).toEqual(["root1:0", "a:0"]);
  });

  it("restores a decoded frontier's order after a rollback", () => {
    const codec = new ColumnarEventGraphCodec();
    const graph = codec.decodeBinary(codec.encodeBinary(wideGraph(4)));
    const view = graph.getFrontierView();
    const before = [...view];
    expect(before).toHaveLength(4);

    const transaction = graph.beginAppendTransaction();
    graph.addEvent(insertEvent("merge:0", [before[2]!, before[0]!]));
    graph.addEvent(insertEvent("tip:0", ["merge:0", before[1]!]));
    transaction.rollback();

    expect([...view]).toEqual(before);
    expect([...graph.getFrontier()]).toEqual(before);
  });

  it("keeps the view in step through a rollback and a clear", () => {
    const graph = new EventGraph();
    graph.addEvent(insertEvent("writer:0", []));
    const view = graph.getFrontierView();
    expect([...view]).toEqual(["writer:0"]);

    const transaction = graph.beginAppendTransaction();
    graph.addEvent(insertEvent("writer:1", ["writer:0"]));
    expect([...view]).toEqual(["writer:1"]);
    transaction.rollback();
    expect([...view]).toEqual(["writer:0"]);

    graph.clear();
    expect(view.size).toBe(0);
    expect(graph.getFrontierSize()).toBe(0);
  });
});

describe("EgWalkerReplica frontier tracking", () => {
  it("gives a local event parents that later appends do not change", () => {
    const replica = new EgWalkerReplica("local");
    for (let index = 0; index < 3; index++) {
      replica.applyRemoteEvent(insertEvent(`peer${index}:0`, [], index));
    }

    const event = replica.insert(0, "L")!;
    const parents = [...event.parentVersion];
    expect(parents).toEqual(["peer0:0", "peer1:0", "peer2:0"]);

    replica.applyRemoteEvent(insertEvent("peer3:0", [], 3));
    replica.insert(0, "M");

    expect([...event.parentVersion]).toEqual(parents);
    expect(replica.getFrontier()).toEqual(new Set(["local:1"]));
  });

  it("still takes the plain-text path for an event that extends the frontier", () => {
    const replica = new EgWalkerReplica("local");
    replica.applyRemoteEvent(insertEvent("peer:0", []));
    const before = replica.getReplayStats();

    replica.applyRemoteEvent(insertEvent("peer:1", ["peer:0"]));

    const after = replica.getReplayStats();
    expect(after.fullReplays).toBe(before.fullReplays);
    expect(after.partialReplays).toBe(before.partialReplays);
    expect(after.incrementalApplies).toBe(before.incrementalApplies + 1);
    expect(replica.getText()).toBe("xx");
  });

  it("keeps the frontier across a remote event that fails and rolls back", () => {
    const replica = new EgWalkerReplica("local");
    for (let index = 0; index < 3; index++) {
      replica.applyRemoteEvent(insertEvent(`peer${index}:0`, [], index));
    }
    const before = [...replica.getFrontier()];

    expect(() =>
      replica.applyRemoteEvent({
        id: "bad:0",
        parentVersion: new Set(["peer0:0", "peer2:0"]),
        operation: { type: OPERATION_TYPE.DELETE, index: 5, length: 9 },
        timestamp: 9,
      }),
    ).toThrow();

    expect([...replica.getFrontier()]).toEqual(before);
    expect(replica.getText()).toBe("xxx");
    replica.applyRemoteEvent(insertEvent("peer3:0", ["peer0:0"], 3));
    expect(replica.getFrontier()).toEqual(
      new Set(["peer1:0", "peer2:0", "peer3:0"]),
    );
  });
});
