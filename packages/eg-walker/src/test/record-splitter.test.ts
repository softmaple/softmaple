import { describe, expect, it } from "vitest";

import { IndexedSequence } from "../engine/indexed-sequence";
import { DeleteTargetIndex } from "../engine/internals/delete-target-index";
import {
  ItemTable,
  type AugmentedCRDTItem,
} from "../engine/internals/engine-types";
import { EventItemIndex } from "../engine/internals/event-item-index";
import { OriginLeftIndex } from "../engine/internals/origin-left-index";
import { RecordSplitter } from "../engine/internals/record-splitter";
import {
  itemsFromRecords,
  type EngineSequenceRecord,
} from "../engine/internals/sequence-records";
import { crdtItem } from "./test-helpers";

describe("RecordSplitter canonical typed-run spans", () => {
  it("resolves and isolates a numeric event span without formatting IDs", () => {
    // Local version `n` is the canonical event `replica:n`; 99 is custom.
    const REPLICA = 0;
    const CUSTOM = 99;
    const item = crdtItem({
      id: 1,
      agent: REPLICA,
      sequence: 0,
      offset: 0,
      content: "abcdef",
      originLeft: null,
      originRight: null,
      everDeleted: false,
      prepareState: 1,
      run: true,
    });
    const sequence = new IndexedSequence<AugmentedCRDTItem>(
      (candidate) => candidate.content.length,
      (candidate) => candidate.content.length,
      [item],
    );
    const items = new ItemTable();
    items.add(item);
    const events = {
      agentAt: (localVersion: number) =>
        localVersion === CUSTOM ? -1 : REPLICA,
      sequenceAt: (localVersion: number) => localVersion,
    };
    const eventItems = new EventItemIndex(events);
    eventItems.registerRunItem(item);
    const splitter = new RecordSplitter({
      sequence,
      items,
      events,
      eventItems,
      originLeftIndex: new OriginLeftIndex(),
      deleteTargets: new DeleteTargetIndex(),
      nextPlaceholderSerial: () => 0,
    });

    expect(
      splitter.isolateRunSpanForCanonicalEvents(REPLICA, -1, 2),
    ).toBeNull();
    expect(splitter.isolateRunSpanForCanonicalEvents(REPLICA, 0, 0)).toBeNull();
    expect(splitter.isolateRunSpanForCanonicalEvents(7, 0, 2)).toBeNull();

    const isolated = splitter.isolateRunSpanForCanonicalEvents(REPLICA, 2, 2);

    expect(isolated?.content).toBe("cd");
    expect(
      Array.from(
        { length: sequence.length },
        (_, index) => sequence.at(index)?.content,
      ),
    ).toEqual(["ab", "cd", "ef"]);
    expect(eventItems.getRunItem(REPLICA, 2)).toBe(isolated);
    expect(eventItems.getRunItem(REPLICA, 6)).toBeUndefined();
    expect(splitter.isolateRunSpanForEvents(CUSTOM, 2)).toBeNull();
    expect(splitter.isolateRunSpanForEvents(4, 2)?.content).toBe("ef");
  });
});

describe("RecordSplitter split halves", () => {
  it("lays out every right half with the fields of every other item, in order", () => {
    // Arrange
    const records = [
      sequenceRecord("alice:0:0", "alice:0", {
        replicaId: "alice",
        startSequence: 0,
      }),
      sequenceRecord("paste:0", "paste", null),
      sequenceRecord("__placeholder__:0", "__placeholder__", null),
    ];
    const restored = itemsFromRecords(records);
    const sequence = new IndexedSequence<AugmentedCRDTItem>(
      (candidate) => candidate.content.length,
      (candidate) => candidate.content.length,
      restored,
    );
    const items = new ItemTable();
    restored.forEach((item) => items.add(item));
    const events = { agentAt: () => -1, sequenceAt: () => 0 };
    const eventItems = new EventItemIndex(events);
    eventItems.registerRunItem(restored[0]!);
    const splitter = new RecordSplitter({
      sequence,
      items,
      events,
      eventItems,
      originLeftIndex: new OriginLeftIndex(),
      deleteTargets: new DeleteTargetIndex(),
      nextPlaceholderSerial: () => 1,
    });

    // Act: split the placeholder, the insert run and the typed run.
    for (const position of [2, 1, 0]) {
      splitter.splitRecordAt(position, 2);
    }

    // Assert
    const halves = sequence.toArray();
    expect(halves.map((item) => item.content)).toEqual([
      "ab",
      "cd",
      "ab",
      "cd",
      "ab",
      "cd",
    ]);
    expect(halves.map((item) => Object.keys(item))).toEqual(
      halves.map(() => ITEM_FIELDS),
    );
  });
});

// Helpers

/** Every `AugmentedCRDTItem` field, in the order each creation site uses. */
const ITEM_FIELDS = [
  "id",
  "agent",
  "sequence",
  "offset",
  "content",
  "originLeft",
  "originRight",
  "everDeleted",
  "prepareState",
  "run",
  "placeholder",
  "external",
  "sequenceLeaf",
  "runNode",
];

const sequenceRecord = (
  id: string,
  eventId: string,
  run: EngineSequenceRecord["run"],
): EngineSequenceRecord => ({
  id,
  eventId,
  content: "abcd",
  originLeft: null,
  originRight: null,
  everDeleted: false,
  prepareState: 1,
  run,
});
