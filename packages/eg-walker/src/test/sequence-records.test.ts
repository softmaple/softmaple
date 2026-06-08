import { describe, expect, it } from "vitest";

import type { AugmentedCRDTItem } from "../engine/internals/engine-types";
import {
  itemFromRecord,
  recordFromItem,
  recordsFromItems,
  sequenceFromRecords,
} from "../engine/internals/sequence-records";

describe("engine sequence records", () => {
  it("clones CRDT items into serializable sequence records and back", () => {
    const item: AugmentedCRDTItem = {
      id: "alice:1:0",
      eventId: "alice:1",
      content: "ab",
      originLeft: "alice:0:0",
      originRight: null,
      everDeleted: false,
      prepareState: 1,
      run: { replicaId: "alice", startSequence: 1 },
    };

    const record = recordFromItem(item);
    const restored = itemFromRecord(record);

    expect(record).toEqual(item);
    expect(restored).toEqual(item);
    expect(record.run).not.toBe(item.run);
    expect(restored.run).not.toBe(record.run);

    item.content = "changed";
    item.originLeft = null;

    expect(record.content).toBe("ab");
    expect(record.originLeft).toBe("alice:0:0");
    restored.content = "restored changed";
    expect(record.content).toBe("ab");
  });

  it("restores records into an indexed sequence with stable ranked weights", () => {
    const items: AugmentedCRDTItem[] = [
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

    const sequence = sequenceFromRecords(recordsFromItems(items));
    const restoredItems = sequence.toArray();

    expect(sequence.toArray()).toEqual(items);
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
