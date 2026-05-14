import { describe, expect, it } from "vitest";
import type { AugmentedCRDTItem } from "../engine/internals/engine-types";
import { OriginLeftIndex } from "../engine/internals/origin-left-index";
import type { EventId } from "../types";

const makeItem = (
  id: EventId,
  originLeft: EventId | null,
): AugmentedCRDTItem => ({
  id,
  eventId: id,
  content: "x",
  originLeft,
  originRight: null,
  everDeleted: false,
  prepareState: 1,
  run: null,
});

describe("OriginLeftIndex", () => {
  describe("track / has", () => {
    it("is a no-op when originLeft is null", () => {
      const index = new OriginLeftIndex();
      index.track("item-a", null);
      expect(index.has("item-a")).toBe(false);
    });

    it("reports membership for items that anchor on a tracked id", () => {
      const index = new OriginLeftIndex();
      index.track("item-a", "anchor");
      expect(index.has("anchor")).toBe(true);
    });

    it("returns false for ids that have never been targeted", () => {
      const index = new OriginLeftIndex();
      index.track("item-a", "anchor");
      expect(index.has("item-a")).toBe(false);
      expect(index.has("unrelated")).toBe(false);
    });

    it("accumulates multiple anchors on the same target", () => {
      const index = new OriginLeftIndex();
      index.track("item-a", "anchor");
      index.track("item-b", "anchor");
      expect(index.has("anchor")).toBe(true);
    });
  });

  describe("clear", () => {
    it("removes all tracked references", () => {
      const index = new OriginLeftIndex();
      index.track("item-a", "anchor");
      index.clear();
      expect(index.has("anchor")).toBe(false);
    });
  });

  describe("rewriteReferences", () => {
    it("is a no-op when no item points at the old origin", () => {
      const index = new OriginLeftIndex();
      const itemsById = new Map<EventId, AugmentedCRDTItem>();
      // Should not throw and should leave the new-origin entry absent.
      index.rewriteReferences("missing", "new-anchor", itemsById);
      expect(index.has("missing")).toBe(false);
      expect(index.has("new-anchor")).toBe(false);
    });

    it("repoints item.originLeft in place and moves the index entry", () => {
      const index = new OriginLeftIndex();
      const item = makeItem("item-a", "old-anchor");
      const itemsById = new Map<EventId, AugmentedCRDTItem>([[item.id, item]]);
      index.track(item.id, item.originLeft);

      index.rewriteReferences("old-anchor", "new-anchor", itemsById);

      expect(item.originLeft).toBe("new-anchor");
      expect(index.has("old-anchor")).toBe(false);
      expect(index.has("new-anchor")).toBe(true);
    });

    it("skips refs whose item.originLeft no longer matches the old origin", () => {
      // A stale ref can survive if a prior rewrite never made it through
      // (e.g. the item was deleted). The rewrite must not clobber an
      // item that has since been repointed somewhere else.
      const index = new OriginLeftIndex();
      const stale = makeItem("item-stale", "elsewhere");
      const live = makeItem("item-live", "old-anchor");
      const itemsById = new Map<EventId, AugmentedCRDTItem>([
        [stale.id, stale],
        [live.id, live],
      ]);
      index.track(stale.id, "old-anchor");
      index.track(live.id, "old-anchor");

      index.rewriteReferences("old-anchor", "new-anchor", itemsById);

      expect(stale.originLeft).toBe("elsewhere");
      expect(live.originLeft).toBe("new-anchor");
      expect(index.has("new-anchor")).toBe(true);
    });

    it("merges into an existing new-anchor set instead of replacing it", () => {
      const index = new OriginLeftIndex();
      const moved = makeItem("item-moved", "old-anchor");
      const preexisting = makeItem("item-pre", "new-anchor");
      const itemsById = new Map<EventId, AugmentedCRDTItem>([
        [moved.id, moved],
        [preexisting.id, preexisting],
      ]);
      index.track(moved.id, "old-anchor");
      index.track(preexisting.id, "new-anchor");

      index.rewriteReferences("old-anchor", "new-anchor", itemsById);

      // Both the moved ref and the pre-existing ref must still anchor on
      // the new id; replacing the set would drop preexisting.id and break
      // a subsequent split that depends on the merged membership.
      expect(index.has("new-anchor")).toBe(true);
      index.rewriteReferences("new-anchor", "newer-anchor", itemsById);
      expect(moved.originLeft).toBe("newer-anchor");
      expect(preexisting.originLeft).toBe("newer-anchor");
    });

    it("drops the old-origin entry even when every ref turned out to be stale", () => {
      const index = new OriginLeftIndex();
      const stale = makeItem("item-stale", "elsewhere");
      const itemsById = new Map<EventId, AugmentedCRDTItem>([
        [stale.id, stale],
      ]);
      index.track(stale.id, "old-anchor");

      index.rewriteReferences("old-anchor", "new-anchor", itemsById);

      expect(index.has("old-anchor")).toBe(false);
      // Nothing actually moved, so the new anchor should not pick up a
      // bogus empty set either.
      expect(index.has("new-anchor")).toBe(false);
    });
  });
});
