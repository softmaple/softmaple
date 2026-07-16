import { describe, expect, it } from "vitest";

import { IndexedSequence } from "../engine/indexed-sequence";
import { DeleteTargetIndex } from "../engine/internals/delete-target-index";
import type { AugmentedCRDTItem } from "../engine/internals/engine-types";
import { EventItemIndex } from "../engine/internals/event-item-index";
import { OriginLeftIndex } from "../engine/internals/origin-left-index";
import { RecordSplitter } from "../engine/internals/record-splitter";

describe("RecordSplitter canonical typed-run spans", () => {
  it("resolves and isolates a numeric event span without formatting IDs", () => {
    const item: AugmentedCRDTItem = {
      id: "replica:0:0",
      eventId: "replica:0",
      content: "abcdef",
      originLeft: null,
      originRight: null,
      everDeleted: false,
      prepareState: 1,
      run: { replicaId: "replica", startSequence: 0 },
    };
    const sequence = new IndexedSequence<AugmentedCRDTItem>(
      (candidate) => candidate.content.length,
      (candidate) => candidate.content.length,
      [item],
    );
    const itemsById = new Map([[item.id, item]]);
    const eventItems = new EventItemIndex();
    eventItems.registerRunItem(item);
    const splitter = new RecordSplitter({
      sequence,
      itemsById,
      eventItems,
      originLeftIndex: new OriginLeftIndex(),
      deleteTargets: new DeleteTargetIndex(),
      nextPlaceholderId: () => "unused-placeholder",
    });

    expect(
      splitter.isolateRunSpanForCanonicalEvents("replica", -1, 2),
    ).toBeNull();
    expect(
      splitter.isolateRunSpanForCanonicalEvents("replica", 0, 0),
    ).toBeNull();
    expect(
      splitter.isolateRunSpanForCanonicalEvents("missing", 0, 2),
    ).toBeNull();

    const isolated = splitter.isolateRunSpanForCanonicalEvents("replica", 2, 2);

    expect(isolated?.content).toBe("cd");
    expect(
      Array.from(
        { length: sequence.length },
        (_, index) => sequence.at(index)?.content,
      ),
    ).toEqual(["ab", "cd", "ef"]);
    expect(eventItems.getRunItem("replica", 2)).toBe(isolated);
    expect(eventItems.getRunItem("replica", 6)).toBeUndefined();
    expect(splitter.isolateRunSpanForEvents("custom-id", 2)).toBeNull();
    expect(splitter.isolateRunSpanForEvents("replica:4", 2)?.content).toBe(
      "ef",
    );
  });
});
