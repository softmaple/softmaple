import { describe, expect, it } from "vitest";
import { DeleteTargetIndex } from "../engine/internals/delete-target-index";

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
