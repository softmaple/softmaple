/**
 * Deterministic regression tests for Section 3.4 typed-run coalescing
 * under concurrent edits that anchor inside / at the right boundary of a
 * coalesced run.
 *
 * Background — why anchoring at the right edge converges
 * ------------------------------------------------------
 *
 * Once contiguous single-character INSERTs from one author collapse into
 * one ranked-B-tree record `R`, every code unit in `R` shares the same
 * id (`R.id`). A concurrent edit `B` from another replica that wants to
 * insert "to the right of the run" picks up `R.id` as its anchor on its
 * own local engine, where `R` is still whole. A second concurrent edit
 * `C` that anchors inside `R` triggers a split, after which `R.id` only
 * covers the prefix — and there is no anchor identity that uniquely
 * names "after the last code unit of the original `R`".
 *
 * The engine sidesteps the apparent anchor-drift by never broadcasting
 * `originLeft` / `originRight` on the wire — `GraphEvent` carries only
 * `id`, `parentVersion`, `operation`, and `timestamp`. Each replica
 * recomputes both origins locally during integration: it retreats to the
 * event's `parentVersion`, finds the prepare-visible record at
 * `operation.index`, and reads the neighbouring record ids. After any
 * split (local or remote) the post-split right half is always the
 * `originLeft` a "right-edge" insert resolves to, because the prepare
 * visibility traversal walks the post-split sequence.
 *
 * These tests pin that property down with concrete, small event sets so
 * a future change that accidentally couples wire format to local CRDT
 * anchors (or that fails to update prepare-visibility after a typed-run
 * split) breaks visibly. The randomized sweep in
 * `convergence-property.test.ts` exercises the same property
 * stochastically — these are the deterministic counterparts.
 */

import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import type { GraphEvent } from "../types";
import { cloneEvent } from "./test-helpers";

const permutations = <T>(arr: ReadonlyArray<T>): T[][] => {
  if (arr.length <= 1) {
    return [arr.slice()];
  }
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) {
      out.push([arr[i]!, ...p]);
    }
  }
  return out;
};

const linearTypedRun = (replicaId: string, text: string): GraphEvent[] => {
  const events: GraphEvent[] = [];
  for (let i = 0; i < text.length; i++) {
    events.push({
      id: `${replicaId}:${i}`,
      parentVersion: new Set(i === 0 ? [] : [`${replicaId}:${i - 1}`]),
      operation: { type: OPERATION_TYPE.INSERT, index: i, text: text[i]! },
      timestamp: i,
    });
  }
  return events;
};

const replayUnderEveryDeliveryOrder = (
  events: ReadonlyArray<GraphEvent>,
): Set<string> => {
  const outputs = new Set<string>();
  for (const p of permutations(events)) {
    const replica = new EgWalkerReplica("R", "");
    for (const event of p) {
      replica.applyRemoteEvent(cloneEvent(event));
    }
    // Skip deliveries that left buffered events behind — those orderings
    // never resolve to a complete state on this replica.
    if (replica.getPendingRemoteCount() !== 0) {
      continue;
    }
    outputs.add(replica.getText());
  }
  return outputs;
};

describe("typed-run coalescing — anchor + split convergence", () => {
  it("converges when one peer anchors at the run's right edge and another splits it inside", () => {
    // A types "abcde" as one typed-run record.
    // B forks at A:4, inserts "X" at index 5 (right of the run).
    // C forks at A:4, inserts "Y" at index 3 (inside the run at offset 3).
    // Expected: "abcYdeX" in every delivery order.
    const events: GraphEvent[] = [
      ...linearTypedRun("A", "abcde"),
      {
        id: "B:0",
        parentVersion: new Set(["A:4"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 5, text: "X" },
        timestamp: 10,
      },
      {
        id: "C:0",
        parentVersion: new Set(["A:4"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 3, text: "Y" },
        timestamp: 11,
      },
    ];
    const outputs = replayUnderEveryDeliveryOrder(events);
    expect([...outputs]).toEqual(["abcYdeX"]);
  });

  it("converges when one peer anchors at the right edge and another deletes inside", () => {
    // A types "abcde". B inserts "X" at index 5. C deletes [2, 4) ("cd").
    // Expected: "abeX" — the right-edge anchor must follow the deleted
    // suffix's right neighbour, not collapse into the deleted slice.
    const events: GraphEvent[] = [
      ...linearTypedRun("A", "abcde"),
      {
        id: "B:0",
        parentVersion: new Set(["A:4"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 5, text: "X" },
        timestamp: 10,
      },
      {
        id: "C:0",
        parentVersion: new Set(["A:4"]),
        operation: { type: OPERATION_TYPE.DELETE, index: 2, length: 2 },
        timestamp: 11,
      },
    ];
    const outputs = replayUnderEveryDeliveryOrder(events);
    expect([...outputs]).toEqual(["abeX"]);
  });

  it("converges across two concurrent inside-splits at different offsets plus a right-edge insert", () => {
    // Three concurrent edits all forking at A:4:
    //   B:0 inserts "X" at index 5 (right edge).
    //   C:0 inserts "P" at index 2 (inside, offset 2).
    //   D:0 inserts "Q" at index 4 (inside, offset 4).
    // Two distinct splits inside the run plus an end-anchor: every
    // delivery order must converge to the same string.
    //
    // This test enumerates all 8! = 40 320 delivery orders, each
    // applying 8 events through `EgWalkerReplica.applyRemoteEvent`,
    // which itself runs the engine's incremental `applyEvent` +
    // `getText` per event. Locally that is ~1.3 s, but under the
    // vitest --coverage workflow (`v8` instrumentation amplifies
    // every per-event branch) it lands around 4.9 s on `ubuntu-latest`
    // CI runners — close enough to the 5 s vitest default that any
    // small overhead (e.g. the extra branch added for the typed-run
    // pending-insert buffer in #693) flips it into a timeout. Match
    // the explicit timeout used by the sibling property-sweep tests
    // in `convergence-property.test.ts` so the budget covers the
    // worst case with margin rather than tracking the default by
    // luck.
    const events: GraphEvent[] = [
      ...linearTypedRun("A", "abcde"),
      {
        id: "B:0",
        parentVersion: new Set(["A:4"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 5, text: "X" },
        timestamp: 10,
      },
      {
        id: "C:0",
        parentVersion: new Set(["A:4"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "P" },
        timestamp: 11,
      },
      {
        id: "D:0",
        parentVersion: new Set(["A:4"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 4, text: "Q" },
        timestamp: 12,
      },
    ];
    const outputs = replayUnderEveryDeliveryOrder(events);
    expect(outputs.size).toBe(1);
    expect([...outputs][0]).toBe("abPcdQeX");
  }, 30_000);

  it("converges when a multi-char paste anchors at the right edge of a typed run", () => {
    // A types "abcde" (typed run). B pastes "WXYZ" at index 5. C inserts
    // "_" at index 3 (inside). The multi-character paste must land
    // contiguously after the run, even when C's split moves the run's
    // tail to a new right-half record before B is integrated.
    const events: GraphEvent[] = [
      ...linearTypedRun("A", "abcde"),
      {
        id: "B:0",
        parentVersion: new Set(["A:4"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 5, text: "WXYZ" },
        timestamp: 10,
      },
      {
        id: "C:0",
        parentVersion: new Set(["A:4"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 3, text: "_" },
        timestamp: 11,
      },
    ];
    const outputs = replayUnderEveryDeliveryOrder(events);
    expect([...outputs]).toEqual(["abc_deWXYZ"]);
  });

  it("falls back to per-character records for non-canonical event ids (no coalescing)", () => {
    // Custom ids (no `replicaId:sequence` shape) MUST skip typed-run
    // coalescing — the run-extension guard checks `parseEventId(event.id)`
    // first. The end result is still correct text; only the runtime
    // record count is affected. This pins the guard down so a future
    // change to `parseEventId` can't quietly start coalescing custom-id
    // authors and corrupt their anchor identity.
    const events: GraphEvent[] = [
      {
        id: "custom-id-1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
        timestamp: 0,
      },
      {
        id: "custom-id-2",
        parentVersion: new Set(["custom-id-1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "b" },
        timestamp: 1,
      },
      {
        id: "custom-id-3",
        parentVersion: new Set(["custom-id-2"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "c" },
        timestamp: 2,
      },
    ];
    const outputs = replayUnderEveryDeliveryOrder(events);
    expect([...outputs]).toEqual(["abc"]);
  });
});
