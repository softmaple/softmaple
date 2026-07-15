import { describe, expect, it } from "vitest";
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

describe("DeleteTargetIndex", () => {
  describe("record / targetsOf", () => {
    it("returns undefined for an unrecorded delete event", () => {
      const index = new DeleteTargetIndex();
      expect(index.targetsOf("missing")).toBeUndefined();
    });

    it("stores the recorded target list under the delete event", () => {
      const index = new DeleteTargetIndex();
      index.record("delete-1", ["item-a", "item-b"]);
      expect(Array.from(index.targetsOf("delete-1") ?? [])).toEqual([
        "item-a",
        "item-b",
      ]);
      expect(index.targetRefsOf("delete-1")).toEqual(["item-a", "item-b"]);
    });

    it("exposes a scalar hot-path ref while preserving targetsOf array semantics", () => {
      const index = new DeleteTargetIndex();
      index.recordOne("delete-1", "item-a");

      expect(index.targetRefsOf("delete-1")).toBe("item-a");
      expect(index.targetsOf("delete-1")).toEqual(["item-a"]);
    });

    it("tracks reverse membership for scalar records", () => {
      const index = new DeleteTargetIndex();
      index.recordOne("delete-1", "item-left");

      index.extendMembership("item-left", "item-right");

      expect(index.targetsOf("delete-1")).toEqual(["item-left", "item-right"]);
    });

    it("defensively copies the caller's array so later mutations don't leak in", () => {
      const index = new DeleteTargetIndex();
      const ids = ["item-a", "item-b"];
      index.record("delete-1", ids);
      ids.push("item-c");
      expect(Array.from(index.targetsOf("delete-1") ?? [])).toEqual([
        "item-a",
        "item-b",
      ]);
    });

    it("accepts an empty target list", () => {
      const index = new DeleteTargetIndex();
      index.record("delete-empty", []);
      expect(Array.from(index.targetsOf("delete-empty") ?? [])).toEqual([]);
      expect(index.targetRefsOf("delete-empty")).toEqual([]);
      expect(index.targetRefsOf("missing")).toBeUndefined();
    });
  });

  describe("entries", () => {
    it("returns defensive target arrays for scalar and multi-target records", () => {
      const index = new DeleteTargetIndex();
      index.record("delete-scalar", ["item-a"]);
      index.record("delete-many", ["item-b", "item-c"]);

      const entries = index.entries();
      expect(entries).toEqual([
        { deleteEventId: "delete-scalar", targetIds: ["item-a"] },
        {
          deleteEventId: "delete-many",
          targetIds: ["item-b", "item-c"],
        },
      ]);

      const manyTargets = entries[1]?.targetIds as string[] | undefined;
      manyTargets?.push("item-mutated");
      expect(index.targetsOf("delete-many")).toEqual(["item-b", "item-c"]);
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
      index.recordRuntimeOne("delete-placeholder", target);

      expect(() => index.targetsOf("delete-placeholder")).toThrow(
        "require a materializer",
      );
      expect(index.entries(() => ["placeholder:0"])).toEqual([
        {
          deleteEventId: "delete-placeholder",
          targetIds: ["placeholder:0"],
        },
      ]);
    });
  });

  describe("packed target arena", () => {
    it("walks mixed targets through allocation-free numeric cursors", () => {
      const state = new SegmentedPlaceholderState<AugmentedCRDTItem>(
        8,
        "placeholder:0",
        () => "placeholder:1",
      );
      const index = new DeleteTargetIndex();
      const group = index.beginRecord();
      index.appendItem(group, "item-left");
      index.appendPlaceholderRange(group, state, 2, 6);
      index.appendItem(group, "item-right");
      index.commitRecord("delete-mixed", group);

      const first = index.firstTargetOf("delete-mixed");
      expect(index.kindOf(first)).toBe(DELETE_TARGET_KIND.ITEM);
      expect(index.itemIdOf(first)).toBe("item-left");

      const second = index.nextTarget(first);
      expect(index.kindOf(second)).toBe(DELETE_TARGET_KIND.PLACEHOLDER);
      expect(index.placeholderStateOf(second)).toBe(state);
      expect(index.placeholderStartOf(second)).toBe(2);
      expect(index.placeholderEndOf(second)).toBe(6);

      const third = index.nextTarget(second);
      expect(index.kindOf(third)).toBe(DELETE_TARGET_KIND.ITEM);
      expect(index.itemIdOf(third)).toBe("item-right");
      expect(index.nextTarget(third)).toBe(0);
      expect(index.firstTargetOf("missing")).toBe(0);

      expect(index.targetRefsOf("delete-mixed")).toEqual([
        "item-left",
        {
          kind: "placeholder-range",
          state,
          start: 2,
          end: 6,
        },
        "item-right",
      ]);
    });

    it("grows group and target columns geometrically without changing order", () => {
      const index = new DeleteTargetIndex();
      for (let groupIndex = 0; groupIndex < 40; groupIndex++) {
        const group = index.beginRecord();
        for (let targetIndex = 0; targetIndex < 40; targetIndex++) {
          index.appendItem(group, `item:${groupIndex}:${targetIndex}`);
        }
        index.commitRecord(`delete:${groupIndex}`, group);
      }

      let target = index.firstTargetOf("delete:39");
      for (let targetIndex = 0; targetIndex < 40; targetIndex++) {
        expect(index.itemIdOf(target)).toBe(`item:39:${targetIndex}`);
        target = index.nextTarget(target);
      }
      expect(target).toBe(0);
      expect(index.entries()).toHaveLength(40);
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
      index.commitRecord("delete-large-offset", group);

      const target = index.firstTargetOf("delete-large-offset");
      expect(index.placeholderStartOf(target)).toBe(start);
      expect(index.placeholderEndOf(target)).toBe(end);
    });

    it("aborts an uncommitted group and reuses its target storage safely", () => {
      const index = new DeleteTargetIndex();
      const aborted = index.beginRecord();
      index.appendItem(aborted, "aborted-left");
      index.appendItem(aborted, "aborted-right");
      index.abortRecord(aborted);

      expect(index.firstTargetOf("aborted-delete")).toBe(0);
      index.extendMembership("aborted-left", "should-not-appear");

      const committed = index.beginRecord();
      index.appendItem(committed, "live-left");
      index.commitRecord("live-delete", committed);
      expect(index.targetsOf("live-delete")).toEqual(["live-left"]);
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
      runtime.recordRuntimeOne("delete-placeholder", {
        kind: "placeholder-range",
        state,
        start: 0,
        end: 4,
      });

      // Physical placeholder splits do not extend coordinate targets. At the
      // snapshot boundary the range becomes stable logical item IDs instead.
      runtime.extendMembership("placeholder:0", "physical-right");
      expect(runtime.entries(() => ["logical-left"])).toEqual([
        {
          deleteEventId: "delete-placeholder",
          targetIds: ["logical-left"],
        },
      ]);

      const restored = new DeleteTargetIndex();
      restored.record("delete-placeholder", ["logical-left"]);
      restored.extendMembership("logical-left", "logical-right");
      expect(restored.targetsOf("delete-placeholder")).toEqual([
        "logical-left",
        "logical-right",
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
      expect(() => index.appendItem(group + 1, "wrong-group")).toThrow(
        "not the active builder",
      );
      expect(() => index.commitRecord("wrong-delete", group + 1)).toThrow(
        "not the active builder",
      );
      expect(() => index.abortRecord(group + 1)).toThrow(
        "not the active builder",
      );

      index.appendItem(group, "item");
      index.appendPlaceholderRange(group, state, 1, 3);
      index.commitRecord("delete", group);

      const item = index.firstTargetOf("delete");
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
        index.recordRuntimeOne("negative", invalidTarget(-1, 1)),
      ).toThrow("Invalid placeholder delete target");
      expect(() =>
        index.recordRuntime("reversed", [
          invalidTarget(0, 1),
          invalidTarget(3, 2),
        ]),
      ).toThrow("Invalid placeholder delete target");

      const throwingItems = ["item-before-error"];
      Object.defineProperty(throwingItems, Symbol.iterator, {
        value: function* () {
          yield "item-before-error";
          throw new Error("iterator failed");
        },
      });
      expect(() => index.record("iterator-error", throwingItems)).toThrow(
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
          index.recordRuntimeOne("invalid-range", invalidTarget(start, end)),
        ).toThrow("Invalid placeholder delete target");
      }

      expect(index.entries()).toEqual([]);
      index.recordOne("reused", "live-item");
      expect(index.targetsOf("reused")).toEqual(["live-item"]);
    });

    it("removes stale reverse membership when a delete record is replaced", () => {
      const index = new DeleteTargetIndex();
      index.recordOne("delete-a", "shared");
      index.recordOne("delete-b", "shared");

      index.recordOne("delete-a", "replacement-a");
      index.extendMembership("shared", "shared-right");
      expect(index.targetsOf("delete-a")).toEqual(["replacement-a"]);
      expect(index.targetsOf("delete-b")).toEqual(["shared", "shared-right"]);

      index.recordOne("delete-b", "replacement-b");
      index.extendMembership("shared", "orphan-right");
      expect(index.targetsOf("delete-b")).toEqual(["replacement-b"]);
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
      index.recordRuntime("delete", [firstTarget, secondTarget]);

      const refs = index.targetRefsOf("delete");
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
      index.extendMembership("unknown", "to");
      // Nothing was ever recorded, so the new target should not appear
      // under any delete event.
      expect(index.targetsOf("unknown")).toBeUndefined();
    });

    it("extends every delete event that targeted the source item", () => {
      // A typed-run record that was previously deleted by two concurrent
      // delete events gets split. Both deletes must now also target the
      // new right half so their retreat/advance still flips the right
      // slice's prepare-state.
      const index = new DeleteTargetIndex();
      index.record("delete-1", ["item-left"]);
      index.record("delete-2", ["item-left"]);

      index.extendMembership("item-left", "item-right");

      expect(Array.from(index.targetsOf("delete-1") ?? [])).toEqual([
        "item-left",
        "item-right",
      ]);
      expect(Array.from(index.targetsOf("delete-2") ?? [])).toEqual([
        "item-left",
        "item-right",
      ]);
      expect(index.targetRefsOf("delete-1")).toEqual([
        "item-left",
        "item-right",
      ]);
      expect(index.targetRefsOf("delete-2")).toEqual([
        "item-left",
        "item-right",
      ]);
    });

    it("does not extend deletes that never targeted the source item", () => {
      const index = new DeleteTargetIndex();
      index.record("delete-relevant", ["item-left"]);
      index.record("delete-other", ["item-elsewhere"]);

      index.extendMembership("item-left", "item-right");

      expect(Array.from(index.targetsOf("delete-other") ?? [])).toEqual([
        "item-elsewhere",
      ]);
    });

    it("is idempotent on a repeat extension to the same (from, to) pair", () => {
      // Two splits inside the same record can route through extendMembership
      // with the same destination; the second call must not append a
      // duplicate entry that would later double-toggle prepare-state under
      // retreat/advance.
      const index = new DeleteTargetIndex();
      index.record("delete-1", ["item-left"]);

      index.extendMembership("item-left", "item-right");
      index.extendMembership("item-left", "item-right");

      expect(Array.from(index.targetsOf("delete-1") ?? [])).toEqual([
        "item-left",
        "item-right",
      ]);
      expect(index.targetRefsOf("delete-1")).toEqual([
        "item-left",
        "item-right",
      ]);
    });
  });

  describe("clear", () => {
    it("drops both the forward and reverse indices", () => {
      const index = new DeleteTargetIndex();
      index.record("delete-1", ["item-a"]);
      index.clear();

      expect(index.targetsOf("delete-1")).toBeUndefined();

      // The reverse index is also cleared: extending after clear() must
      // not resurrect the membership.
      index.extendMembership("item-a", "item-b");
      expect(index.targetsOf("delete-1")).toBeUndefined();
    });
  });
});
