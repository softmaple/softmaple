import { describe, expect, it, vi } from "vitest";
import {
  DELETE_TARGET_KIND,
  DeleteTargetIndex,
  isPlaceholderDeleteTarget,
  iterateCompactDeleteTargets,
  recordsFromCompactDeleteTargets,
  type PlaceholderDeleteTarget,
} from "../engine/internals/delete-target-index";
import type { AugmentedCRDTItem } from "../engine/internals/engine-types";
import { SegmentedPlaceholderState } from "../engine/internals/segmented-placeholder";

const AUTHOR = 0;
const ids = new Map<string, number>();
const names: string[] = [];
/** Stable numeric key for a readable test name. */
const id = (name: string): number => {
  let key = ids.get(name);
  if (key === undefined) {
    key = names.length + 1;
    ids.set(name, key);
    names.push(name);
  }
  return key;
};
const nameOf = (key: number): string => {
  const name = names[key - 1];
  if (name === undefined) {
    throw new Error(`Unknown test key ${key}`);
  }
  return name;
};

describe("DeleteTargetIndex", () => {
  describe("record / targetsOf", () => {
    it("returns undefined for an unrecorded delete event", () => {
      const index = new DeleteTargetIndex();
      expect(index.targetsOf(id("missing"))).toBeUndefined();
    });

    it("stores the recorded target list under the delete event", () => {
      const index = new DeleteTargetIndex();
      index.record(id("delete-1"), [id("item-a"), id("item-b")]);
      expect(Array.from(index.targetsOf(id("delete-1")) ?? [])).toEqual([
        id("item-a"),
        id("item-b"),
      ]);
      expect(index.targetRefsOf(id("delete-1"))).toEqual([
        id("item-a"),
        id("item-b"),
      ]);
    });

    it("exposes a scalar hot-path ref while preserving targetsOf array semantics", () => {
      const index = new DeleteTargetIndex();
      index.recordOne(id("delete-1"), id("item-a"));

      expect(index.targetRefsOf(id("delete-1"))).toBe(id("item-a"));
      expect(index.targetsOf(id("delete-1"))).toEqual([id("item-a")]);
    });

    it("materializes a lazy typed-run event target to an item target", () => {
      const index = new DeleteTargetIndex();
      index.recordRunEvent(id("delete-1"), AUTHOR, 4);
      expect(index.hasRunEventTargets()).toBe(true);

      const target = index.firstTargetOf(id("delete-1"));
      expect(index.kindOf(target)).toBe(DELETE_TARGET_KIND.RUN_EVENT);
      expect(index.runEventSequenceOf(target)).toBe(4);
      expect(index.targetRefsOf(id("delete-1"))).toEqual({
        kind: "typed-run-event",
        agent: AUTHOR,
        sequence: 4,
      });
      expect(() => index.targetsOf(id("delete-1"))).toThrow(
        "must be materialized",
      );

      index.materializeRunEventTargetsOf(id("delete-1"), (agent, sequence) =>
        agent === AUTHOR && sequence === 4
          ? id("author:4:0")
          : id("unreachable"),
      );

      expect(index.kindOf(target)).toBe(DELETE_TARGET_KIND.ITEM);
      expect(index.hasRunEventTargets()).toBe(false);
      expect(index.targetsOf(id("delete-1"))).toEqual([id("author:4:0")]);
      index.extendMembership(id("author:4:0"), id("author:5:0"));
      expect(index.targetsOf(id("delete-1"))).toEqual([
        id("author:4:0"),
        id("author:5:0"),
      ]);
    });

    it("keeps lazy target accounting exact across runtime records, replacement, and abort", () => {
      const index = new DeleteTargetIndex();
      index.recordRuntime(id("delete-1"), [
        { kind: "typed-run-event", agent: AUTHOR, sequence: 4 },
        id("ordinary-item"),
        { kind: "typed-run-event", agent: AUTHOR, sequence: 5 },
      ]);
      expect(index.hasRunEventTargets()).toBe(true);

      index.materializeRunEventTargets((_agent, sequence) =>
        id(`author:${sequence}:item`),
      );
      expect(index.targetsOf(id("delete-1"))).toEqual([
        id("author:4:item"),
        id("ordinary-item"),
        id("author:5:item"),
      ]);
      expect(index.hasRunEventTargets()).toBe(false);

      index.recordRunEvent(id("delete-1"), AUTHOR, 6);
      expect(index.hasRunEventTargets()).toBe(true);
      index.recordOne(id("delete-1"), id("replacement-item"));
      expect(index.hasRunEventTargets()).toBe(false);
      expect(index.targetsOf(id("delete-1"))).toEqual([id("replacement-item")]);

      const aborted = index.beginRecord();
      index.appendRunEvent(aborted, AUTHOR, 7);
      expect(index.hasRunEventTargets()).toBe(true);
      index.abortRecord(aborted);
      expect(index.hasRunEventTargets()).toBe(false);

      index.materializeRunEventTargetsOf(id("missing"), () =>
        id("unreachable"),
      );
    });

    it("rolls back lazy and placeholder builders after validation or commit errors", () => {
      const index = new DeleteTargetIndex();
      const state = new SegmentedPlaceholderState<AugmentedCRDTItem>(
        4,
        "placeholder:0",
        () => "placeholder:1",
      );
      expect(() =>
        index.recordPlaceholderRange(id("invalid-placeholder"), state, -1, 1),
      ).toThrow("Invalid placeholder delete target");

      const commit = vi
        .spyOn(index, "commitRecord")
        .mockImplementationOnce(() => {
          throw new Error("simulated commit failure");
        });
      expect(() =>
        index.recordRunEvent(id("failed-delete"), AUTHOR, 4),
      ).toThrow("simulated commit failure");
      commit.mockRestore();

      expect(index.firstTargetOf(id("failed-delete"))).toBe(0);
      expect(index.hasRunEventTargets()).toBe(false);
      index.recordOne(id("live-delete"), id("item"));
      expect(() =>
        index.runEventAgentOf(index.firstTargetOf(id("live-delete"))),
      ).toThrow("is not a typed-run event target");
    });

    it("tracks reverse membership for scalar records", () => {
      const index = new DeleteTargetIndex();
      index.recordOne(id("delete-1"), id("item-left"));

      index.extendMembership(id("item-left"), id("item-right"));

      expect(index.targetsOf(id("delete-1"))).toEqual([
        id("item-left"),
        id("item-right"),
      ]);
    });

    it("defensively copies the caller's array so later mutations don't leak in", () => {
      const index = new DeleteTargetIndex();
      const ids = [id("item-a"), id("item-b")];
      index.record(id("delete-1"), ids);
      ids.push(id("item-c"));
      expect(Array.from(index.targetsOf(id("delete-1")) ?? [])).toEqual([
        id("item-a"),
        id("item-b"),
      ]);
    });

    it("accepts an empty target list", () => {
      const index = new DeleteTargetIndex();
      index.record(id("delete-empty"), []);
      expect(Array.from(index.targetsOf(id("delete-empty")) ?? [])).toEqual([]);
      expect(index.targetRefsOf(id("delete-empty"))).toEqual([]);
      expect(index.targetRefsOf(id("missing"))).toBeUndefined();
    });
  });

  describe("entries", () => {
    it("returns defensive target arrays for scalar and multi-target records", () => {
      const index = new DeleteTargetIndex();
      index.record(id("delete-scalar"), [id("item-a")]);
      index.record(id("delete-many"), [id("item-b"), id("item-c")]);

      const entries = index.entries(nameOf);
      expect(entries).toEqual([
        { deleteEvent: id("delete-scalar"), targetIds: ["item-a"] },
        {
          deleteEvent: id("delete-many"),
          targetIds: ["item-b", "item-c"],
        },
      ]);

      const manyTargets = entries[1]?.targetIds as string[] | undefined;
      manyTargets?.push("item-mutated");
      expect(index.targetsOf(id("delete-many"))).toEqual([
        id("item-b"),
        id("item-c"),
      ]);
    });

    it("materializes runtime placeholder ranges only at the legacy boundary", () => {
      const state = new SegmentedPlaceholderState<AugmentedCRDTItem>(
        4,
        "placeholder:0",
        () => "placeholder:1",
      );
      const target: PlaceholderDeleteTarget = {
        kind: "placeholder-range",
        state,
        start: 0,
        end: 4,
      };
      const index = new DeleteTargetIndex();
      index.recordRuntimeOne(id("delete-placeholder"), target);

      expect(() => index.targetsOf(id("delete-placeholder"))).toThrow(
        "require a materializer",
      );
      expect(index.entries(nameOf, () => ["placeholder:0"])).toEqual([
        {
          deleteEvent: id("delete-placeholder"),
          targetIds: ["placeholder:0"],
        },
      ]);
    });
  });

  describe("packed target arena", () => {
    it("keeps packed delete keys numeric until replay-order materialization", () => {
      const state = new SegmentedPlaceholderState<AugmentedCRDTItem>(
        8,
        "placeholder:0",
        () => "placeholder:1",
      );
      const index = new DeleteTargetIndex();
      index.configurePackedOrderRange(10, 15);

      index.recordPackedPlaceholderRange(12, state, 2, 4);
      const itemGroup = index.beginRecord();
      index.appendItem(itemGroup, id("item:left"));
      index.commitPackedRecord(10, itemGroup);
      index.recordPackedRunEvent(14, AUTHOR, 4);

      expect(index.entries(nameOf)).toEqual([]);
      expect(index.hasPackedRecords()).toBe(true);
      expect(index.kindOf(index.firstTargetOfPackedOrder(10))).toBe(
        DELETE_TARGET_KIND.ITEM,
      );
      expect(index.kindOf(index.firstTargetOfPackedOrder(12))).toBe(
        DELETE_TARGET_KIND.PLACEHOLDER,
      );
      expect(index.kindOf(index.firstTargetOfPackedOrder(14))).toBe(
        DELETE_TARGET_KIND.RUN_EVENT,
      );
      expect(() => index.firstTargetOfPackedOrder(9)).toThrow(
        "Invalid packed delete order index",
      );
      expect(() => index.firstTargetOfPackedOrder(15)).toThrow(
        "Invalid packed delete order index",
      );

      index.materializeRunEventTargetsOfPackedOrder(14, () => id("author:4:0"));
      index.extendMembership(id("item:left"), id("item:right"));
      index.materializePackedRecords((orderIndex) =>
        id(`delete:${orderIndex}`),
      );

      expect(index.hasPackedRecords()).toBe(false);
      expect(index.hasPackedOrderRange()).toBe(false);
      expect(
        index.entries(nameOf, ({ start, end }) => [
          `placeholder:${start}:${end}`,
        ]),
      ).toEqual([
        {
          deleteEvent: id("delete:10"),
          targetIds: ["item:left", "item:right"],
        },
        {
          deleteEvent: id("delete:12"),
          targetIds: ["placeholder:2:4"],
        },
        { deleteEvent: id("delete:14"), targetIds: ["author:4:0"] },
      ]);
    });

    it("rejects duplicate packed ranks without replacing the live target", () => {
      const index = new DeleteTargetIndex();
      index.configurePackedOrderRange(0, 2);
      index.recordPackedRunEvent(0, AUTHOR, 0);

      expect(() => index.assertPackedOrderRangeAvailable(0, 2)).toThrow(
        "Duplicate packed delete order index 0",
      );
      expect(() => index.recordPackedRunEvent(0, AUTHOR, 1)).toThrow(
        "Duplicate packed delete order index 0",
      );
      expect(index.runEventSequenceOf(index.firstTargetOfPackedOrder(0))).toBe(
        0,
      );
      index.materializeRunEventTargetsOfPackedOrder(0, () => id("author:0:0"));
      index.materializePackedRecords((orderIndex) =>
        id(`delete:${orderIndex}`),
      );
      expect(index.targetsOf(id("delete:0"))).toEqual([id("author:0:0")]);
      expect(index.hasRunEventTargets()).toBe(false);
    });

    it("keeps a packed target retryable after an ID collision", () => {
      const index = new DeleteTargetIndex();
      index.record(id("collision"), [id("existing")]);
      index.configurePackedOrderRange(10, 11);
      const group = index.beginRecord();
      index.appendItem(group, id("packed"));
      index.commitPackedRecord(10, group);

      expect(() => index.materializePackedRecord(10, id("collision"))).toThrow(
        `Duplicate materialized delete event ${id("collision")}`,
      );
      expect(index.targetsOf(id("collision"))).toEqual([id("existing")]);
      expect(index.hasPackedRecords()).toBe(true);
      expect(index.itemIdOf(index.firstTargetOfPackedOrder(10))).toBe(
        id("packed"),
      );

      index.materializePackedRecord(10, id("delete:10"));
      index.releasePackedOrderRange();
      expect(index.entries(nameOf)).toEqual([
        { deleteEvent: id("collision"), targetIds: ["existing"] },
        { deleteEvent: id("delete:10"), targetIds: ["packed"] },
      ]);
    });

    it("clears and reuses packed order ranges above the uint16 boundary", () => {
      const index = new DeleteTargetIndex();
      index.configurePackedOrderRange(65_535, 70_002);
      index.recordPackedRunEvent(65_536, AUTHOR, 1);
      index.recordPackedRunEvent(70_000, AUTHOR, 2);
      expect(index.firstTargetOfPackedOrder(65_536)).not.toBe(0);
      expect(index.firstTargetOfPackedOrder(70_000)).not.toBe(0);

      index.clear();
      index.configurePackedOrderRange(7, 9);
      expect(index.hasPackedRecords()).toBe(false);
      expect(index.hasRunEventTargets()).toBe(false);
      expect(index.firstTargetOfPackedOrder(7)).toBe(0);
      index.recordPackedRunEvent(8, AUTHOR, 3);
      expect(index.runEventSequenceOf(index.firstTargetOfPackedOrder(8))).toBe(
        3,
      );
    });

    it("walks mixed targets through allocation-free numeric cursors", () => {
      const state = new SegmentedPlaceholderState<AugmentedCRDTItem>(
        8,
        "placeholder:0",
        () => "placeholder:1",
      );
      const index = new DeleteTargetIndex();
      const group = index.beginRecord();
      index.appendItem(group, id("item-left"));
      index.appendPlaceholderRange(group, state, 2, 6);
      index.appendItem(group, id("item-right"));
      index.commitRecord(id("delete-mixed"), group);

      const first = index.firstTargetOf(id("delete-mixed"));
      expect(index.kindOf(first)).toBe(DELETE_TARGET_KIND.ITEM);
      expect(index.itemIdOf(first)).toBe(id("item-left"));

      const second = index.nextTarget(first);
      expect(index.kindOf(second)).toBe(DELETE_TARGET_KIND.PLACEHOLDER);
      expect(index.placeholderStateOf(second)).toBe(state);
      expect(index.placeholderStartOf(second)).toBe(2);
      expect(index.placeholderEndOf(second)).toBe(6);

      const third = index.nextTarget(second);
      expect(index.kindOf(third)).toBe(DELETE_TARGET_KIND.ITEM);
      expect(index.itemIdOf(third)).toBe(id("item-right"));
      expect(index.nextTarget(third)).toBe(0);
      expect(index.firstTargetOf(id("missing"))).toBe(0);

      expect(index.targetRefsOf(id("delete-mixed"))).toEqual([
        id("item-left"),
        {
          kind: "placeholder-range",
          state,
          start: 2,
          end: 6,
        },
        id("item-right"),
      ]);
    });

    it("grows group and target columns geometrically without changing order", () => {
      const index = new DeleteTargetIndex();
      for (let groupIndex = 0; groupIndex < 40; groupIndex++) {
        const group = index.beginRecord();
        for (let targetIndex = 0; targetIndex < 40; targetIndex++) {
          index.appendItem(group, id(`item:${groupIndex}:${targetIndex}`));
        }
        index.commitRecord(id(`delete:${groupIndex}`), group);
      }

      let target = index.firstTargetOf(id("delete:39"));
      for (let targetIndex = 0; targetIndex < 40; targetIndex++) {
        expect(index.itemIdOf(target)).toBe(id(`item:39:${targetIndex}`));
        target = index.nextTarget(target);
      }
      expect(target).toBe(0);
      expect(index.entries(nameOf)).toHaveLength(40);
    });

    it("preserves safe-integer placeholder offsets above the uint32 range", () => {
      const length = 0x1_0000_0040;
      const start = 0x1_0000_0010;
      const end = 0x1_0000_0030;
      const state = new SegmentedPlaceholderState<AugmentedCRDTItem>(
        length,
        "placeholder:0",
        () => "placeholder:1",
      );
      const index = new DeleteTargetIndex();
      const group = index.beginRecord();
      index.appendPlaceholderRange(group, state, start, end);
      index.commitRecord(id("delete-large-offset"), group);

      const target = index.firstTargetOf(id("delete-large-offset"));
      expect(index.placeholderStartOf(target)).toBe(start);
      expect(index.placeholderEndOf(target)).toBe(end);
    });

    it("aborts an uncommitted group and reuses its target storage safely", () => {
      const index = new DeleteTargetIndex();
      const aborted = index.beginRecord();
      index.appendItem(aborted, id("aborted-left"));
      index.appendItem(aborted, id("aborted-right"));
      index.abortRecord(aborted);

      expect(index.firstTargetOf(id("aborted-delete"))).toBe(0);
      index.extendMembership(id("aborted-left"), id("should-not-appear"));

      const committed = index.beginRecord();
      index.appendItem(committed, id("live-left"));
      index.commitRecord(id("live-delete"), committed);
      expect(index.targetsOf(id("live-delete"))).toEqual([id("live-left")]);
      const next = index.beginRecord();
      index.abortRecord(next);
    });

    it("materializes placeholder coordinates before rebuilding split membership", () => {
      const state = new SegmentedPlaceholderState<AugmentedCRDTItem>(
        4,
        "placeholder:0",
        () => "placeholder:1",
      );
      const runtime = new DeleteTargetIndex();
      runtime.recordRuntimeOne(id("delete-placeholder"), {
        kind: "placeholder-range",
        state,
        start: 0,
        end: 4,
      });

      // Physical placeholder splits do not extend coordinate targets. At the
      // snapshot boundary the range becomes stable logical item IDs instead.
      runtime.extendMembership(id("placeholder:0"), id("physical-right"));
      expect(runtime.entries(nameOf, () => ["logical-left"])).toEqual([
        {
          deleteEvent: id("delete-placeholder"),
          targetIds: ["logical-left"],
        },
      ]);

      const restored = new DeleteTargetIndex();
      restored.record(id("delete-placeholder"), [id("logical-left")]);
      restored.extendMembership(id("logical-left"), id("logical-right"));
      expect(restored.targetsOf(id("delete-placeholder"))).toEqual([
        id("logical-left"),
        id("logical-right"),
      ]);
    });

    it("rejects builder misuse and targets accessed through the wrong cursor kind", () => {
      const state = new SegmentedPlaceholderState<AugmentedCRDTItem>(
        4,
        "placeholder:0",
        () => "placeholder:1",
      );
      const index = new DeleteTargetIndex();
      const group = index.beginRecord();

      expect(() => index.beginRecord()).toThrow("already active");
      expect(() => index.appendItem(group + 1, id("wrong-group"))).toThrow(
        "not the active builder",
      );
      expect(() => index.commitRecord(id("wrong-delete"), group + 1)).toThrow(
        "not the active builder",
      );
      expect(() => index.abortRecord(group + 1)).toThrow(
        "not the active builder",
      );

      index.appendItem(group, id("item"));
      index.appendPlaceholderRange(group, state, 1, 3);
      index.commitRecord(id("delete"), group);

      const item = index.firstTargetOf(id("delete"));
      const placeholder = index.nextTarget(item);
      expect(() => index.placeholderStateOf(item)).toThrow(
        "is not a placeholder target",
      );
      expect(() => index.placeholderStartOf(item)).toThrow(
        "is not a placeholder target",
      );
      expect(() => index.placeholderEndOf(item)).toThrow(
        "is not a placeholder target",
      );
      expect(() => index.itemIdOf(placeholder)).toThrow(
        "is not an item target",
      );
      expect(() => index.nextTarget(0)).toThrow("Invalid delete target handle");
      expect(() => index.kindOf(Number.NaN)).toThrow(
        "Invalid delete target handle",
      );
      expect(() => index.kindOf(3)).toThrow("Invalid delete target handle");
    });

    it("rolls back every compatibility builder when target creation fails", () => {
      const state = new SegmentedPlaceholderState<AugmentedCRDTItem>(
        4,
        "placeholder:0",
        () => "placeholder:1",
      );
      const invalidTarget = (start: number, end: number) => ({
        kind: "placeholder-range" as const,
        state,
        start,
        end,
      });
      const index = new DeleteTargetIndex();

      expect(() =>
        index.recordRuntimeOne(id("negative"), invalidTarget(-1, 1)),
      ).toThrow("Invalid placeholder delete target");
      expect(() =>
        index.recordRuntime(id("reversed"), [
          invalidTarget(0, 1),
          invalidTarget(3, 2),
        ]),
      ).toThrow("Invalid placeholder delete target");

      const throwingItems = [id("item-before-error")];
      Object.defineProperty(throwingItems, Symbol.iterator, {
        value: function* () {
          yield id("item-before-error");
          throw new Error("iterator failed");
        },
      });
      expect(() => index.record(id("iterator-error"), throwingItems)).toThrow(
        "iterator failed",
      );

      const invalidRanges: ReadonlyArray<readonly [number, number]> = [
        [0.5, 1],
        [0, 1.5],
        [0, 0],
        [0, 5],
      ];
      for (const [start, end] of invalidRanges) {
        expect(() =>
          index.recordRuntimeOne(
            id("invalid-range"),
            invalidTarget(start, end),
          ),
        ).toThrow("Invalid placeholder delete target");
      }

      expect(index.entries(nameOf)).toEqual([]);
      index.recordOne(id("reused"), id("live-item"));
      expect(index.targetsOf(id("reused"))).toEqual([id("live-item")]);
    });

    it("removes stale reverse membership when a delete record is replaced", () => {
      const index = new DeleteTargetIndex();
      index.recordOne(id("delete-a"), id("shared"));
      index.recordOne(id("delete-b"), id("shared"));

      index.recordOne(id("delete-a"), id("replacement-a"));
      index.extendMembership(id("shared"), id("shared-right"));
      expect(index.targetsOf(id("delete-a"))).toEqual([id("replacement-a")]);
      expect(index.targetsOf(id("delete-b"))).toEqual([
        id("shared"),
        id("shared-right"),
      ]);

      index.recordOne(id("delete-b"), id("replacement-b"));
      index.extendMembership(id("shared"), id("orphan-right"));
      expect(index.targetsOf(id("delete-b"))).toEqual([id("replacement-b")]);
    });

    it("reuses one placeholder state reference across multiple ranges", () => {
      const state = new SegmentedPlaceholderState<AugmentedCRDTItem>(
        6,
        "placeholder:0",
        () => "placeholder:1",
      );
      const index = new DeleteTargetIndex();
      const firstTarget: PlaceholderDeleteTarget = {
        kind: "placeholder-range",
        state,
        start: 0,
        end: 2,
      };
      const secondTarget: PlaceholderDeleteTarget = {
        kind: "placeholder-range",
        state,
        start: 4,
        end: 6,
      };
      index.recordRuntime(id("delete"), [firstTarget, secondTarget]);

      const refs = index.targetRefsOf(id("delete"));
      expect(Array.isArray(refs)).toBe(true);
      expect(refs).toEqual([firstTarget, secondTarget]);
      expect(isPlaceholderDeleteTarget(refs ?? [])).toBe(false);
      expect(isPlaceholderDeleteTarget(firstTarget)).toBe(true);
    });
  });

  describe("compact iteration", () => {
    it("decodes compact refs lazily and rejects invalid IDs", () => {
      const compact = {
        idTable: ["delete", "item-a", "item-b"],
        deleteEventRefs: Uint32Array.of(0),
        targetOffsets: Uint32Array.of(0, 2),
        targetRefs: Uint32Array.of(1, 2),
      };

      expect([...iterateCompactDeleteTargets(compact)]).toEqual([
        {
          deleteEventId: "delete",
          targetIds: ["item-a", "item-b"],
        },
      ]);
      expect(() => [
        ...iterateCompactDeleteTargets({
          ...compact,
          deleteEventRefs: Uint32Array.of(9),
        }),
      ]).toThrow("Invalid compact delete target id ref");
      expect(recordsFromCompactDeleteTargets(compact)).toEqual([
        {
          deleteEventId: "delete",
          targetIds: ["item-a", "item-b"],
        },
      ]);
    });
  });

  describe("extendMembership", () => {
    it("is a no-op when the source item has no owning deletes", () => {
      const index = new DeleteTargetIndex();
      index.extendMembership(id("unknown"), id("to"));
      // Nothing was ever recorded, so the new target should not appear
      // under any delete event.
      expect(index.targetsOf(id("unknown"))).toBeUndefined();
    });

    it("extends every delete event that targeted the source item", () => {
      // A typed-run record that was previously deleted by two concurrent
      // delete events gets split. Both deletes must now also target the
      // new right half so their retreat/advance still flips the right
      // slice's prepare-state.
      const index = new DeleteTargetIndex();
      index.record(id("delete-1"), [id("item-left")]);
      index.record(id("delete-2"), [id("item-left")]);

      index.extendMembership(id("item-left"), id("item-right"));

      expect(Array.from(index.targetsOf(id("delete-1")) ?? [])).toEqual([
        id("item-left"),
        id("item-right"),
      ]);
      expect(Array.from(index.targetsOf(id("delete-2")) ?? [])).toEqual([
        id("item-left"),
        id("item-right"),
      ]);
      expect(index.targetRefsOf(id("delete-1"))).toEqual([
        id("item-left"),
        id("item-right"),
      ]);
      expect(index.targetRefsOf(id("delete-2"))).toEqual([
        id("item-left"),
        id("item-right"),
      ]);
    });

    it("does not extend deletes that never targeted the source item", () => {
      const index = new DeleteTargetIndex();
      index.record(id("delete-relevant"), [id("item-left")]);
      index.record(id("delete-other"), [id("item-elsewhere")]);

      index.extendMembership(id("item-left"), id("item-right"));

      expect(Array.from(index.targetsOf(id("delete-other")) ?? [])).toEqual([
        id("item-elsewhere"),
      ]);
    });

    it("is idempotent on a repeat extension to the same (from, to) pair", () => {
      // Two splits inside the same record can route through extendMembership
      // with the same destination; the second call must not append a
      // duplicate entry that would later double-toggle prepare-state under
      // retreat/advance.
      const index = new DeleteTargetIndex();
      index.record(id("delete-1"), [id("item-left")]);

      index.extendMembership(id("item-left"), id("item-right"));
      index.extendMembership(id("item-left"), id("item-right"));

      expect(Array.from(index.targetsOf(id("delete-1")) ?? [])).toEqual([
        id("item-left"),
        id("item-right"),
      ]);
      expect(index.targetRefsOf(id("delete-1"))).toEqual([
        id("item-left"),
        id("item-right"),
      ]);
    });
  });

  describe("clear", () => {
    it("drops both the forward and reverse indices", () => {
      const index = new DeleteTargetIndex();
      index.record(id("delete-1"), [id("item-a")]);
      index.clear();

      expect(index.targetsOf(id("delete-1"))).toBeUndefined();

      // The reverse index is also cleared: extending after clear() must
      // not resurrect the membership.
      index.extendMembership(id("item-a"), id("item-b"));
      expect(index.targetsOf(id("delete-1"))).toBeUndefined();
    });
  });
});
