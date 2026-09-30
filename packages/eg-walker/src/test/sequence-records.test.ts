import { describe, expect, it } from "vitest";

import { AgentTable } from "../graph/internals/agent-table";
import {
  ItemTable,
  type AugmentedCRDTItem,
} from "../engine/internals/engine-types";
import {
  ItemIdCodec,
  sequenceFromRecords,
  type EngineSequenceRecord,
} from "../engine/internals/sequence-records";

const createCodec = (customIds: ReadonlyArray<string> = []): ItemIdCodec => {
  const agents = new AgentTable();
  return new ItemIdCodec({
    agentTable: () => agents,
    localVersionOf: (id) => customIds.indexOf(id),
    idAtLocalVersion: (localVersion) => {
      const id = customIds[localVersion];
      if (id === undefined) {
        throw new Error(`Unknown local version ${localVersion}`);
      }
      return id;
    },
  });
};

describe("engine sequence records", () => {
  it("round-trips records through numeric items without aliasing", () => {
    const records: EngineSequenceRecord[] = [
      {
        id: "alice:0:0",
        eventId: "alice:0",
        content: "A",
        originLeft: null,
        originRight: null,
        everDeleted: false,
        prepareState: 1,
        run: null,
      },
      {
        id: "alice:1:0",
        eventId: "alice:1",
        content: "ab",
        originLeft: "alice:0:0",
        originRight: null,
        everDeleted: false,
        prepareState: 1,
        run: { replicaId: "alice", startSequence: 1 },
      },
    ];
    const codec = createCodec();
    const items = new ItemTable();
    const restored = codec.itemsFromRecords(records, items);
    for (const item of restored) {
      items.add(item);
    }

    expect(restored[1]).toMatchObject({
      sequence: 1,
      offset: 0,
      run: true,
      originLeft: restored[0]!.id,
    });
    expect(restored[1]!.external).toBeUndefined();
    const roundTripped = restored.map((item) =>
      codec.recordFromItem(item, (key) => items.at(key)),
    );
    expect(roundTripped).toEqual(records);
    expect(roundTripped[1]!.run).not.toBe(records[1]!.run);

    restored[1]!.content = "changed";
    expect(roundTripped[1]!.content).toBe("ab");
  });

  it("keeps custom and non-canonical IDs verbatim", () => {
    const records: EngineSequenceRecord[] = [
      {
        id: "custom-event:0",
        eventId: "custom-event",
        content: "x",
        originLeft: null,
        originRight: null,
        everDeleted: false,
        prepareState: 1,
        run: null,
      },
      {
        id: "odd-item",
        eventId: "unknown-event",
        content: "y",
        originLeft: "custom-event:0",
        originRight: null,
        everDeleted: false,
        prepareState: 1,
        run: null,
      },
    ];
    const codec = createCodec(["custom-event"]);
    const items = new ItemTable();
    const restored = codec.itemsFromRecords(records, items);
    for (const item of restored) {
      items.add(item);
    }

    expect(restored[0]!.external).toBeUndefined();
    expect(restored[1]!.external).toEqual({
      id: "odd-item",
      eventId: "unknown-event",
    });
    expect(
      restored.map((item) =>
        codec.recordFromItem(item, (key) => items.at(key)),
      ),
    ).toEqual(records);
  });

  it("rejects records whose origins are not in the batch", () => {
    expect(() =>
      createCodec().itemsFromRecords(
        [
          {
            id: "alice:0:0",
            eventId: "alice:0",
            content: "A",
            originLeft: "missing:0:0",
            originRight: null,
            everDeleted: false,
            prepareState: 1,
            run: null,
          },
        ],
        new ItemTable(),
      ),
    ).toThrow("references unknown item missing:0:0");
  });

  it("restores records into an indexed sequence with stable ranked weights", () => {
    const records: EngineSequenceRecord[] = [
      {
        id: "alice:0:0",
        eventId: "alice:0",
        content: "A",
        originLeft: null,
        originRight: null,
        everDeleted: false,
        prepareState: 1,
        run: { replicaId: "alice", startSequence: 0 },
      },
      {
        id: "bob:0:0",
        eventId: "bob:0",
        content: "BB",
        originLeft: "alice:0:0",
        originRight: null,
        everDeleted: true,
        prepareState: 1,
        run: null,
      },
      {
        id: "carol:0:0",
        eventId: "carol:0",
        content: "C",
        originLeft: "bob:0:0",
        originRight: null,
        everDeleted: false,
        prepareState: 0,
        run: null,
      },
    ];

    const sequence = sequenceFromRecords(records);
    const restoredItems: AugmentedCRDTItem[] = sequence.toArray();

    expect(restoredItems.map((item) => item.content)).toEqual(["A", "BB", "C"]);
    expect(restoredItems.map((item) => item.originLeft)).toEqual([
      null,
      restoredItems[0]!.id,
      restoredItems[1]!.id,
    ]);
    expect(sequence.prepareIndexToPosition(0, false)).toBe(0);
    expect(sequence.prepareIndexToPosition(1, false)).toBe(1);
    expect(sequence.prepareIndexToPosition(2, false)).toBe(1);
    expect(sequence.effectIndexBeforePosition(2)).toBe(1);
    expect(sequence.effectIndexBeforePosition(3)).toBe(2);

    restoredItems[1]!.everDeleted = false;
    sequence.updateItem(restoredItems[1]!);

    expect(sequence.effectIndexBeforePosition(3)).toBe(4);
  });
});
