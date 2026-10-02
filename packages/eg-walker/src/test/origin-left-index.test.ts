import { describe, expect, it, vi } from "vitest";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import type {
  AugmentedCRDTItem,
  ItemKey,
} from "../engine/internals/engine-types";
import { OriginLeftIndex } from "../engine/internals/origin-left-index";
import { EventGraph } from "../graph/event-graph";
import type { GraphEvent } from "../types";
import { measureArrayScanWork } from "./array-scan-work";
import { crdtItem } from "./test-helpers";

const makeItem = (id: ItemKey, originLeft: ItemKey | null): AugmentedCRDTItem =>
  crdtItem({
    id,
    agent: 0,
    sequence: id,
    offset: 0,
    content: "x",
    originLeft,
    originRight: null,
    everDeleted: false,
    prepareState: 1,
    run: false,
  });

const itemLookup =
  (...items: AugmentedCRDTItem[]) =>
  (itemId: ItemKey): AugmentedCRDTItem | undefined =>
    items.find((item) => item.id === itemId);

// Named item keys keep the scenarios readable.
const ITEM_A = 1;
const ITEM_B = 2;
const ANCHOR = 3;
const UNRELATED = 4;
const MISSING = 5;
const NEW_ANCHOR = 6;
const OLD_ANCHOR = 7;
const ITEM_STALE = 8;
const ELSEWHERE = 9;
const ITEM_LIVE = 10;
const ITEM_MOVED = 11;
const ITEM_PRE = 12;
const NEWER_ANCHOR = 13;

describe("OriginLeftIndex", () => {
  it("registers fresh keys across inserts, splits, engine reuse and snapshot restore", () => {
    const registered = new WeakMap<OriginLeftIndex, Set<ItemKey>>();
    const track = OriginLeftIndex.prototype.track;
    const clear = OriginLeftIndex.prototype.clear;
    const trackSpy = vi
      .spyOn(OriginLeftIndex.prototype, "track")
      .mockImplementation(function (
        this: OriginLeftIndex,
        id: ItemKey,
        origin: ItemKey | null,
      ) {
        const keys = registered.get(this) ?? new Set<ItemKey>();
        expect(keys.has(id)).toBe(false);
        keys.add(id);
        registered.set(this, keys);
        track.call(this, id, origin);
      });
    const clearSpy = vi
      .spyOn(OriginLeftIndex.prototype, "clear")
      .mockImplementation(function (this: OriginLeftIndex) {
        registered.delete(this);
        clear.call(this);
      });
    try {
      const insert = (id: string, index: number, text: string): GraphEvent => ({
        id,
        parentVersion: new Set(id === "base:0" ? [] : ["base:0"]),
        operation: { type: "insert", index, text },
        timestamp: 0,
      });
      const history = [
        insert("base:0", 0, "abcdef"),
        ...Array.from({ length: 16 }, (_, n) => insert(`peer-${n}:0`, 6, "x")),
        insert("split-a:0", 2, "Y"),
      ];
      const suffix = insert("split-b:0", 4, "Z");
      const graph = EventGraph.fromEvents([...history, suffix]);
      const source = new EgWalkerEngine();
      for (let replay = 0; replay < 2; replay++) {
        source.generate(history, "", {
          eventGraph: graph,
          eventOrder: history,
        });
      }
      const restored = EgWalkerEngine.fromSnapshotState({
        graph,
        currentVersion: source.getCurrentVersion(),
        text: source.getText(),
        sequenceRecords: source.getSequenceRecords(),
        deleteTargets: source.getDeleteTargetRecords(),
      });
      restored.applyEvent(suffix, graph);

      expect(restored.getText()).toBe(`abYcdZef${"x".repeat(16)}`);
      expect(trackSpy.mock.calls.length).toBeGreaterThan(history.length * 3);
    } finally {
      trackSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  describe("track / has", () => {
    it("is a no-op when originLeft is null", () => {
      const index = new OriginLeftIndex();
      index.track(ITEM_A, null);
      expect(index.has(ITEM_A)).toBe(false);
    });

    it("reports membership for items that anchor on a tracked id", () => {
      const index = new OriginLeftIndex();
      index.track(ITEM_A, ANCHOR);
      expect(index.has(ANCHOR)).toBe(true);
    });

    it("returns false for ids that have never been targeted", () => {
      const index = new OriginLeftIndex();
      index.track(ITEM_A, ANCHOR);
      expect(index.has(ITEM_A)).toBe(false);
      expect(index.has(UNRELATED)).toBe(false);
    });

    it("accumulates multiple anchors on the same target", () => {
      const index = new OriginLeftIndex();
      index.track(ITEM_A, ANCHOR);
      index.track(ITEM_B, ANCHOR);
      expect(index.has(ANCHOR)).toBe(true);
    });
  });

  describe("clear", () => {
    it("removes all tracked references", () => {
      const index = new OriginLeftIndex();
      index.track(ITEM_A, ANCHOR);
      index.clear();
      expect(index.has(ANCHOR)).toBe(false);
    });
  });

  describe("rewriteReferences", () => {
    it("merges many sources without rescanning or copying accumulated targets", () => {
      const index = new OriginLeftIndex();
      const count = 1_000;
      const target = count * 3;
      const items = Array.from({ length: count }, (_, offset) =>
        makeItem(offset + 1, count + offset + 1),
      );
      const itemsById = new Map(items.map((item) => [item.id, item]));
      for (const item of items) {
        index.track(item.id, item.originLeft);
      }

      const work = measureArrayScanWork(() => {
        for (const item of items) {
          index.rewriteReferences(item.originLeft!, target, (id) =>
            itemsById.get(id),
          );
        }
      });

      expect(work).toBeLessThan(count * 8);
      expect(items.every((item) => item.originLeft === target)).toBe(true);
      const visited: ItemKey[] = [];
      index.rewriteReferences(target, target + 1, (id) => {
        visited.push(id);
        return itemsById.get(id);
      });
      expect(visited).toEqual(items.map((item) => item.id));
      expect(items.every((item) => item.originLeft === target + 1)).toBe(true);
    });

    it("preserves existing targets when all source references are missing or stale", () => {
      const index = new OriginLeftIndex();
      const stale = makeItem(ITEM_STALE, ELSEWHERE);
      const existing = [
        makeItem(ITEM_A, NEW_ANCHOR),
        makeItem(ITEM_B, NEW_ANCHOR),
      ];
      index.track(MISSING, OLD_ANCHOR);
      index.track(stale.id, OLD_ANCHOR);
      existing.forEach((item) => index.track(item.id, item.originLeft));
      const lookup = itemLookup(stale, ...existing);

      index.rewriteReferences(OLD_ANCHOR, NEW_ANCHOR, lookup);
      expect(index.has(OLD_ANCHOR)).toBe(false);
      index.rewriteReferences(NEW_ANCHOR, NEWER_ANCHOR, lookup);

      expect(stale.originLeft).toBe(ELSEWHERE);
      expect(existing.map((item) => item.originLeft)).toEqual([
        NEWER_ANCHOR,
        NEWER_ANCHOR,
      ]);
    });

    it("is a no-op when no item points at the old origin", () => {
      const index = new OriginLeftIndex();
      const itemsById = itemLookup();
      // Should not throw and should leave the new-origin entry absent.
      index.rewriteReferences(MISSING, NEW_ANCHOR, itemsById);
      expect(index.has(MISSING)).toBe(false);
      expect(index.has(NEW_ANCHOR)).toBe(false);
    });

    it("repoints item.originLeft in place and moves the index entry", () => {
      const index = new OriginLeftIndex();
      const item = makeItem(ITEM_A, OLD_ANCHOR);
      const itemsById = itemLookup(item);
      index.track(item.id, item.originLeft);

      index.rewriteReferences(OLD_ANCHOR, NEW_ANCHOR, itemsById);

      expect(item.originLeft).toBe(NEW_ANCHOR);
      expect(index.has(OLD_ANCHOR)).toBe(false);
      expect(index.has(NEW_ANCHOR)).toBe(true);
    });

    it("skips refs whose item.originLeft no longer matches the old origin", () => {
      // A stale ref can survive if a prior rewrite never made it through
      // (e.g. the item was deleted). The rewrite must not clobber an
      // item that has since been repointed somewhere else.
      const index = new OriginLeftIndex();
      const stale = makeItem(ITEM_STALE, ELSEWHERE);
      const live = makeItem(ITEM_LIVE, OLD_ANCHOR);
      const itemsById = itemLookup(stale, live);
      index.track(stale.id, OLD_ANCHOR);
      index.track(live.id, OLD_ANCHOR);

      index.rewriteReferences(OLD_ANCHOR, NEW_ANCHOR, itemsById);

      expect(stale.originLeft).toBe(ELSEWHERE);
      expect(live.originLeft).toBe(NEW_ANCHOR);
      expect(index.has(NEW_ANCHOR)).toBe(true);
    });

    it("merges into an existing new-anchor set instead of replacing it", () => {
      const index = new OriginLeftIndex();
      const moved = makeItem(ITEM_MOVED, OLD_ANCHOR);
      const preexisting = makeItem(ITEM_PRE, NEW_ANCHOR);
      const itemsById = itemLookup(moved, preexisting);
      index.track(moved.id, OLD_ANCHOR);
      index.track(preexisting.id, NEW_ANCHOR);

      index.rewriteReferences(OLD_ANCHOR, NEW_ANCHOR, itemsById);

      // Both the moved ref and the pre-existing ref must still anchor on
      // the new id; replacing the set would drop preexisting.id and break
      // a subsequent split that depends on the merged membership.
      expect(index.has(NEW_ANCHOR)).toBe(true);
      index.rewriteReferences(NEW_ANCHOR, NEWER_ANCHOR, itemsById);
      expect(moved.originLeft).toBe(NEWER_ANCHOR);
      expect(preexisting.originLeft).toBe(NEWER_ANCHOR);
    });

    it("drops the old-origin entry even when every ref turned out to be stale", () => {
      const index = new OriginLeftIndex();
      const stale = makeItem(ITEM_STALE, ELSEWHERE);
      const itemsById = itemLookup(stale);
      index.track(stale.id, OLD_ANCHOR);

      index.rewriteReferences(OLD_ANCHOR, NEW_ANCHOR, itemsById);

      expect(index.has(OLD_ANCHOR)).toBe(false);
      // Nothing actually moved, so the new anchor should not pick up a
      // bogus empty set either.
      expect(index.has(NEW_ANCHOR)).toBe(false);
    });
  });
});
