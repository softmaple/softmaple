/**
 * Tests for the structural {@link ApplyRemoteEventResult} surfaced by
 * {@link EgWalkerReplica.applyRemoteEvent}. Pins the contract that
 * consumers rely on so they don't have to infer integration state by
 * comparing `getText()` before and after the call.
 */
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import {
  APPLY_REMOTE_EVENT_STATUS,
  type ApplyRemoteEventResult,
} from "../types";
import { cloneEvent } from "./test-helpers";

describe("EgWalkerReplica.applyRemoteEvent — structural result", () => {
  it("reports `integrated` with a PositionOperation for a simple insert", () => {
    const author = new EgWalkerReplica("author");
    author.insert(0, "hi");
    const [event] = author.exportEventGraph();
    expect(event).toBeDefined();

    const replica = new EgWalkerReplica("replica");
    const result = replica.applyRemoteEvent(cloneEvent(event!));

    expect(result.status).toBe(APPLY_REMOTE_EVENT_STATUS.Integrated);
    if (result.status !== APPLY_REMOTE_EVENT_STATUS.Integrated) {
      throw new Error("status narrowing");
    }
    expect(result.operation).toEqual({
      type: OPERATION_TYPE.INSERT,
      index: 0,
      length: 2,
    });
    expect(replica.getText()).toBe("hi");
  });

  it("reports `integrated` with a delete PositionOperation", () => {
    const author = new EgWalkerReplica("author");
    author.insert(0, "hello");
    author.delete(1, 3);
    const events = author.exportEventGraph();
    expect(events).toHaveLength(2);

    const replica = new EgWalkerReplica("replica");
    replica.applyRemoteEvent(cloneEvent(events[0]!));
    const result = replica.applyRemoteEvent(cloneEvent(events[1]!));

    expect(result.status).toBe(APPLY_REMOTE_EVENT_STATUS.Integrated);
    if (result.status !== APPLY_REMOTE_EVENT_STATUS.Integrated) {
      throw new Error("status narrowing");
    }
    expect(result.operation).toEqual({
      type: OPERATION_TYPE.DELETE,
      index: 1,
      length: 3,
    });
    expect(replica.getText()).toBe("ho");
  });

  it("reports `duplicate` when the same event is delivered twice", () => {
    const author = new EgWalkerReplica("author");
    author.insert(0, "x");
    const [event] = author.exportEventGraph();

    const replica = new EgWalkerReplica("replica");
    const first = replica.applyRemoteEvent(cloneEvent(event!));
    const second = replica.applyRemoteEvent(cloneEvent(event!));

    expect(first.status).toBe(APPLY_REMOTE_EVENT_STATUS.Integrated);
    expect(second.status).toBe(APPLY_REMOTE_EVENT_STATUS.Duplicate);
    expect(replica.getText()).toBe("x");
  });

  it("reports `buffered` when a parent is missing and `integrated` once the parent arrives", () => {
    const author = new EgWalkerReplica("author");
    author.insert(0, "a");
    author.insert(1, "b");
    const [first, second] = author.exportEventGraph();
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    const replica = new EgWalkerReplica("replica");
    // Deliver child before parent: must buffer, document stays empty.
    const bufferedResult = replica.applyRemoteEvent(cloneEvent(second!));
    expect(bufferedResult.status).toBe(APPLY_REMOTE_EVENT_STATUS.Buffered);
    expect(replica.getText()).toBe("");
    expect(replica.getPendingRemoteCount()).toBe(1);

    // Buffering the same event again should be a duplicate, not a re-buffer.
    const reBuffered = replica.applyRemoteEvent(cloneEvent(second!));
    expect(reBuffered.status).toBe(APPLY_REMOTE_EVENT_STATUS.Duplicate);
    expect(replica.getPendingRemoteCount()).toBe(1);

    // Parent arrives: caller's event integrates, buffered child flushes
    // as a side effect (not reported by this call).
    const parentResult = replica.applyRemoteEvent(cloneEvent(first!));
    expect(parentResult.status).toBe(APPLY_REMOTE_EVENT_STATUS.Integrated);
    if (parentResult.status !== APPLY_REMOTE_EVENT_STATUS.Integrated) {
      throw new Error("status narrowing");
    }
    expect(parentResult.operation).toEqual({
      type: OPERATION_TYPE.INSERT,
      index: 0,
      length: 1,
    });
    expect(replica.getPendingRemoteCount()).toBe(0);
    expect(replica.getText()).toBe("ab");
  });

  it("reports `duplicate` when the event is already in the graph", () => {
    const author = new EgWalkerReplica("author");
    author.insert(0, "x");
    const [event] = author.exportEventGraph();

    // Seed the replica from the graph so the event lives in the graph
    // (not in the buffer) before the duplicate delivery.
    const replica = EgWalkerReplica.fromEventGraph("replica", [
      cloneEvent(event!),
    ]);
    const result = replica.applyRemoteEvent(cloneEvent(event!));
    expect(result.status).toBe(APPLY_REMOTE_EVENT_STATUS.Duplicate);
  });

  it("buffered children flush in causal order when their parent integrates", () => {
    const author = new EgWalkerReplica("author");
    author.insert(0, "a");
    author.insert(1, "b");
    author.insert(2, "c");
    const events = author.exportEventGraph();
    expect(events).toHaveLength(3);

    const replica = new EgWalkerReplica("replica");
    // Deliver out of causal order: c (depends on b), b (depends on a), a.
    expect(replica.applyRemoteEvent(cloneEvent(events[2]!)).status).toBe(
      APPLY_REMOTE_EVENT_STATUS.Buffered,
    );
    expect(replica.applyRemoteEvent(cloneEvent(events[1]!)).status).toBe(
      APPLY_REMOTE_EVENT_STATUS.Buffered,
    );
    expect(replica.getPendingRemoteCount()).toBe(2);
    expect(replica.getText()).toBe("");

    const aResult = replica.applyRemoteEvent(cloneEvent(events[0]!));
    expect(aResult.status).toBe(APPLY_REMOTE_EVENT_STATUS.Integrated);
    // The two buffered children flushed transitively; replica text now
    // reflects the full causal chain even though their flush isn't
    // reported through this call.
    expect(replica.getPendingRemoteCount()).toBe(0);
    expect(replica.getText()).toBe("abc");
  });

  it("a partial/full replay returns `integrated` with operation === null", () => {
    // Two replicas branch from the same root then merge. The merge event
    // arrives on a replica whose current version is concurrent with the
    // merge's parent, forcing a retreat — i.e. the engine cannot take
    // the incremental path and the contract says `operation` is null.
    const seedAuthor = new EgWalkerReplica("seed");
    seedAuthor.insert(0, "abc");
    const seed = seedAuthor.exportEventGraph();
    expect(seed).toHaveLength(1);

    const alice = new EgWalkerReplica("alice");
    alice.applyRemoteEvent(cloneEvent(seed[0]!));
    const bob = new EgWalkerReplica("bob");
    bob.applyRemoteEvent(cloneEvent(seed[0]!));

    // Alice and bob each insert concurrently after the same seed.
    alice.insert(0, "A");
    bob.insert(3, "B");
    const aliceLocal = alice.exportEventGraph().slice(1);
    const bobLocal = bob.exportEventGraph().slice(1);
    expect(aliceLocal).toHaveLength(1);
    expect(bobLocal).toHaveLength(1);

    // Replica that already integrated alice's edit then sees bob's
    // concurrent edit. Bob's parentVersion = {seed}, but the replica's
    // current frontier = {alice's event}. canIncrementallyAdvance is
    // false ⇒ partial/full replay path ⇒ operation must be null.
    const result = alice.applyRemoteEvent(cloneEvent(bobLocal[0]!));
    expect(result.status).toBe(APPLY_REMOTE_EVENT_STATUS.Integrated);
    if (result.status !== APPLY_REMOTE_EVENT_STATUS.Integrated) {
      throw new Error("status narrowing");
    }
    expect(result.operation).toBeNull();
    // Sanity: text reflects the merged document so the replay actually ran.
    expect(alice.getText()).toBe("AabcB");
  });

  it("serialize/deserialize round-trips correctly after remote buffering and flushing", () => {
    // Build a two-event causal chain on the author.
    const author = new EgWalkerReplica("author");
    author.insert(0, "hello");
    author.insert(5, " world");
    const [eventA, eventB] = author.exportEventGraph();
    expect(eventA).toBeDefined();
    expect(eventB).toBeDefined();

    // Deliver child before parent so the buffer is exercised.
    const replica = new EgWalkerReplica("replica");
    expect(replica.applyRemoteEvent(cloneEvent(eventB!)).status).toBe(
      APPLY_REMOTE_EVENT_STATUS.Buffered,
    );

    // Parent arrives: child flushes automatically.
    expect(replica.applyRemoteEvent(cloneEvent(eventA!)).status).toBe(
      APPLY_REMOTE_EVENT_STATUS.Integrated,
    );
    expect(replica.getPendingRemoteCount()).toBe(0);
    expect(replica.getText()).toBe("hello world");

    // Serialise and round-trip through JSON (the wire format).
    const serialized = replica.serialize();
    const wire = JSON.parse(JSON.stringify(serialized)) as typeof serialized;
    const restored = EgWalkerReplica.deserialize(wire, "restored");

    expect(restored.getText()).toBe("hello world");
    expect(restored.exportEventGraph().length).toBe(
      replica.exportEventGraph().length,
    );
  });

  it("result is exhaustively narrowable via discriminated union", () => {
    // Compile-time guard: the discriminant must cover all branches.
    const author = new EgWalkerReplica("author");
    author.insert(0, "x");
    const [event] = author.exportEventGraph();
    const replica = new EgWalkerReplica("replica");
    const result: ApplyRemoteEventResult = replica.applyRemoteEvent(
      cloneEvent(event!),
    );
    switch (result.status) {
      case APPLY_REMOTE_EVENT_STATUS.Integrated: {
        expect(result.operation).toBeTruthy();
        break;
      }
      case APPLY_REMOTE_EVENT_STATUS.Buffered:
      case APPLY_REMOTE_EVENT_STATUS.Duplicate: {
        throw new Error(`unexpected status: ${result.status}`);
      }
      default: {
        // exhaustiveness — fails at compile time if a branch is missed.
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  });
});
