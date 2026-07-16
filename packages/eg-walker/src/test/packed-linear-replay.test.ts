import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";
import type { ExternalOperation } from "../types";

const addLinearEvent = (
  graph: EventGraph,
  offset: number,
  operation: ExternalOperation,
): void => {
  graph.addEvent({
    id: `linear:${offset}`,
    parentVersion: offset === 0 ? new Set() : new Set([`linear:${offset - 1}`]),
    operation,
    timestamp: offset,
  });
};

const pack = (graph: EventGraph): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(graph));
};

describe("packed exact-linear replay", () => {
  it("skips rope boundary descents when metadata proves the text is BMP", () => {
    const replica = new EgWalkerReplica("local", "a".repeat(4_096));
    const codeUnitAt = vi.spyOn(PersistentUtf16Rope.prototype, "codeUnitAt");

    replica.insert(2_048, "x");
    replica.delete(2_048, 1);

    expect(codeUnitAt).not.toHaveBeenCalled();
    codeUnitAt.mockRestore();

    const emoji = new EgWalkerReplica("emoji", "🙂");
    emoji.delete(0, 2);
    const afterDelete = vi.spyOn(PersistentUtf16Rope.prototype, "codeUnitAt");
    emoji.insert(0, "a");
    expect(afterDelete).not.toHaveBeenCalled();
    afterDelete.mockRestore();
  });

  it("coalesces the checkpoint-free prefix into bounded rope edits", () => {
    const graph = new EventGraph();
    const pieces = Array.from({ length: 256 }, (_, index) =>
      index % 3 === 0 ? "🙂" : index % 3 === 1 ? "a" : "é",
    );
    let eventOffset = 0;
    let documentLength = 0;
    for (const piece of pieces) {
      addLinearEvent(graph, eventOffset++, {
        type: OPERATION_TYPE.INSERT,
        index: documentLength,
        text: piece,
      });
      documentLength += piece.length;
    }
    const deletedPieces = 96;
    for (let index = 0; index < deletedPieces; index++) {
      addLinearEvent(graph, eventOffset++, {
        type: OPERATION_TYPE.DELETE,
        index: 0,
        length: pieces[index]!.length,
      });
    }

    const packed = pack(graph);
    PersistentUtf16Rope.resetInstrumentation();
    const replica = new EgWalkerReplica("restored", "", packed);
    const instrumentation = PersistentUtf16Rope.getInstrumentation();

    expect(replica.getText()).toBe(pieces.slice(deletedPieces).join(""));
    expect(instrumentation.nodeAllocations).toBeLessThan(eventOffset / 2);
    expect(replica.getReplayStats().checkpointCount).toBe(32);
  });

  it("preserves repeated same-index insert order", () => {
    const graph = new EventGraph();
    const pieces = Array.from({ length: 64 }, (_, index) =>
      String.fromCharCode(0x21 + index),
    );
    pieces.forEach((piece, offset) =>
      addLinearEvent(graph, offset, {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: piece,
      }),
    );

    const replica = new EgWalkerReplica("restored", "", pack(graph));

    expect(replica.getText()).toBe([...pieces].reverse().join(""));
  });

  it("still rejects a coalesced delete that would split a surrogate pair", () => {
    const graph = new EventGraph();
    addLinearEvent(graph, 0, {
      type: OPERATION_TYPE.DELETE,
      index: 0,
      length: 1,
    });
    addLinearEvent(graph, 1, {
      type: OPERATION_TYPE.DELETE,
      index: 0,
      length: 1,
    });
    for (let offset = 2; offset < 42; offset++) {
      addLinearEvent(graph, offset, {
        type: OPERATION_TYPE.INSERT,
        index: 999,
        text: "",
      });
    }

    expect(() => new EgWalkerReplica("restored", "a🙂", pack(graph))).toThrow(
      /surrogate halves/,
    );
  });
});
