import { describe, expect, it, vi } from "vitest";

import { NativeSnapshotCodec } from "../core/native-snapshot";
import type { PortableSnapshot } from "../core/portable-snapshot";
import { PortableSnapshotCodec } from "../core/portable-snapshot-codec";
import { EgWalkerReplica } from "../core/replica";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import type { GraphEvent } from "../types";
import { createPrng } from "./test-helpers";

const codec = new PortableSnapshotCodec();

/**
 * Type at a moving cursor, with an occasional backspace, so a replay that
 * starts from a checkpoint edits text it did not replay itself.
 */
const typeAt = (
  replica: EgWalkerReplica,
  count: number,
  random: () => number,
): GraphEvent[] => {
  const events: GraphEvent[] = [];
  for (let index = 0; index < count; index++) {
    const length = replica.getText().length;
    if (length > 0 && random() < 0.15) {
      const event = replica.delete(Math.floor(random() * length), 1);
      if (event !== null) {
        events.push(event);
      }
      continue;
    }
    const event = replica.insert(
      Math.floor(random() * (length + 1)),
      String.fromCharCode(0x61 + Math.floor(random() * 26)),
    );
    if (event !== null) {
      events.push(event);
    }
  }
  return events;
};

/**
 * Long chains between concurrent bursts longer than a sliced preparation's
 * engine and linear steps, then enough short rounds to fill the retained
 * checkpoint window. Alice ends having merged Bob's last burst while Bob
 * has not merged hers, so her frontier has two heads.
 */
const concurrentHistory = (): EgWalkerReplica => {
  const random = createPrng(974);
  const alice = new EgWalkerReplica("alice");
  const bob = new EgWalkerReplica("bob");
  for (let round = 0; round < 3; round++) {
    bob.applyRemoteEvents(typeAt(alice, 2_500, random));
    const fromAlice = typeAt(alice, 200, random);
    const fromBob = typeAt(bob, 200, random);
    alice.applyRemoteEvents(fromBob);
    bob.applyRemoteEvents(fromAlice);
  }
  for (let round = 0; round < 40; round++) {
    const fromAlice = typeAt(alice, 3, random);
    const fromBob = typeAt(bob, 3, random);
    alice.applyRemoteEvents(fromBob);
    bob.applyRemoteEvents(fromAlice);
  }
  typeAt(alice, 20, random);
  alice.applyRemoteEvents(typeAt(bob, 20, random));
  return alice;
};

/** One author: the history replays as one exact chain. */
const linearHistory = (): EgWalkerReplica => {
  const author = new EgWalkerReplica("author");
  typeAt(author, 6_000, createPrng(941));
  return author;
};

/** EGWP1 bytes whose in-process validation proof was not kept. */
const untrustedBytes = (snapshot: PortableSnapshot): Uint8Array =>
  codec.encode(snapshot).slice();

const restore = (bytes: Uint8Array): EgWalkerReplica =>
  EgWalkerReplica.fromPortableSnapshot(codec.decode(bytes), "reader");

/** Settles right away and counts how often preparation yielded. */
const countingYield = () => {
  const counter = {
    yields: 0,
    yieldToHost: (): Promise<void> => {
      counter.yields++;
      return Promise.resolve();
    },
  };
  return counter;
};

/** Holds preparation at its next yield until `release()` is called. */
const gatedYield = () => {
  const gate = {
    yields: 0,
    release: (): void => undefined,
    yieldToHost: (): Promise<void> => {
      gate.yields++;
      return new Promise<void>((resolve) => {
        gate.release = resolve;
      });
    },
  };
  return gate;
};

const late = (parent: string): GraphEvent => ({
  id: "carol:0",
  operation: { type: "insert", index: 0, text: "C" },
  parentVersion: new Set([parent]),
  timestamp: 1,
});

describe("EgWalkerReplica.prepare", () => {
  it.each([
    ["concurrent", concurrentHistory],
    ["linear", linearHistory],
  ])("leaves the replay state a validation on first use leaves, for a %s history", async (_name, build) => {
    // Arrange
    const source = build();
    const bytes = untrustedBytes(source.createPortableSnapshot());
    const onFirstUse = restore(bytes);
    const prepared = restore(bytes);
    const host = countingYield();
    const divergent = late(source.exportEventGraph().at(-60)!.id);

    // Act
    onFirstUse.exportEventGraph();
    await prepared.prepare({ sliceMs: 0, yieldToHost: host.yieldToHost });

    // Assert: the same state, reached in many slices.
    expect(host.yields).toBeGreaterThan(10);
    expect(prepared.getReplayStats()).toEqual(onFirstUse.getReplayStats());
    expect(prepared.getReplayStats().snapshotValidationReplays).toBe(1);
    expect(prepared.getText()).toBe(source.getText());

    // And the same behavior afterwards.
    onFirstUse.applyRemoteEvent(divergent);
    prepared.applyRemoteEvent(divergent);
    onFirstUse.insert(0, "!");
    prepared.insert(0, "!");
    expect(prepared.getText()).toBe(onFirstUse.getText());
    expect(prepared.getReplayStats()).toEqual(onFirstUse.getReplayStats());
  });

  it("keeps a retained replay engine from the validation replay", async () => {
    // Arrange
    const source = concurrentHistory();
    const replica = restore(untrustedBytes(source.createPortableSnapshot()));

    // Act
    await replica.prepare({ sliceMs: 0 });

    // Assert: the frontier has two heads, so the last section's engine stays.
    expect(replica.getFrontier().size).toBe(2);
    expect(replica.getReplayStats().sequenceRecordCount).toBeGreaterThan(0);
    expect(replica.getReplayStats().replayCacheEvents).toBeGreaterThan(0);
  });

  it("makes the first local edit replay nothing", async () => {
    // Arrange
    const source = concurrentHistory();
    const replica = restore(untrustedBytes(source.createPortableSnapshot()));
    await replica.prepare();
    const generated = vi.spyOn(EgWalkerEngine.prototype, "generate");
    const generatedPacked = vi.spyOn(
      EgWalkerEngine.prototype,
      "generatePackedSectionRange",
    );
    const generatedInSteps = vi.spyOn(
      EgWalkerEngine.prototype,
      "generatePackedSectionRangeSteps",
    );

    try {
      // Act
      replica.insert(0, "!");

      // Assert
      expect(generated).not.toHaveBeenCalled();
      expect(generatedPacked).not.toHaveBeenCalled();
      expect(generatedInSteps).not.toHaveBeenCalled();
      expect(replica.getText()).toBe(`!${source.getText()}`);
      expect(replica.getReplayStats()).toMatchObject({
        snapshotValidationReplays: 1,
        fullReplays: 0,
        partialReplays: 0,
      });
    } finally {
      generated.mockRestore();
      generatedPacked.mockRestore();
      generatedInSteps.mockRestore();
    }
  });

  it("keeps answering reads with the restored state while it prepares", async () => {
    // Arrange
    const source = concurrentHistory();
    const snapshot = codec.decode(
      untrustedBytes(source.createPortableSnapshot()),
    );
    const replica = EgWalkerReplica.fromPortableSnapshot(snapshot, "reader");
    const restoredStats = replica.getReplayStats();
    const seen: Array<{
      readonly text: string;
      readonly frontier: ReadonlySet<string>;
      readonly prepared: boolean;
      readonly stats: ReturnType<EgWalkerReplica["getReplayStats"]>;
    }> = [];

    // Act
    await replica.prepare({
      sliceMs: 0,
      yieldToHost: () => {
        seen.push({
          text: replica.getText(),
          frontier: replica.getFrontier(),
          prepared: replica.isPrepared(),
          stats: replica.getReplayStats(),
        });
        return Promise.resolve();
      },
    });

    // Assert
    expect(seen.length).toBeGreaterThan(20);
    for (const state of seen) {
      expect(state.text).toBe(snapshot.text);
      expect(state.frontier).toEqual(new Set(snapshot.currentVersion));
      expect(state.prepared).toBe(false);
      expect(state.stats).toEqual(restoredStats);
    }
    expect(replica.isPrepared()).toBe(true);
  });

  it("rejects a snapshot whose text does not match its history, before any local event", async () => {
    // Arrange
    const snapshot = codec.decode(
      untrustedBytes(concurrentHistory().createPortableSnapshot()),
    );
    const replica = EgWalkerReplica.fromPortableSnapshot({
      ...snapshot,
      text: `${snapshot.text}?`,
    });
    const restoredStats = replica.getReplayStats();

    // Act and assert
    await expect(replica.prepare({ sliceMs: 0 })).rejects.toThrow(
      /materialized text mismatch/,
    );
    expect(replica.isPrepared()).toBe(false);
    expect(replica.getText()).toBe(`${snapshot.text}?`);
    expect(replica.getFrontier()).toEqual(new Set(snapshot.currentVersion));
    expect(replica.getReplayStats()).toEqual(restoredStats);
    // The next attempt proves the snapshot again, and no event is created.
    expect(() => replica.insert(0, "!")).toThrow(/materialized text mismatch/);
    await expect(replica.prepare()).rejects.toThrow(
      /materialized text mismatch/,
    );
    expect(replica.getFrontier()).toEqual(new Set(snapshot.currentVersion));
  });

  it("rejects a history that does not decode", async () => {
    // Arrange
    const snapshot = codec.decode(
      untrustedBytes(concurrentHistory().createPortableSnapshot()),
    );
    const eventGraph = snapshot.eventGraph.slice();
    eventGraph[eventGraph.length >> 1]! ^= 0xff;
    const replica = EgWalkerReplica.fromPortableSnapshot({
      ...snapshot,
      eventGraph,
    });

    // Act and assert
    await expect(replica.prepare()).rejects.toThrow(/checksum mismatch/);
    expect(replica.isPrepared()).toBe(false);
    expect(replica.getText()).toBe(snapshot.text);
  });

  it("finishes in an operation that needs the history, and settles with it", async () => {
    // Arrange
    const source = concurrentHistory();
    const replica = restore(untrustedBytes(source.createPortableSnapshot()));
    const gate = gatedYield();

    // Act: the first slice runs at once, then preparation waits at the gate.
    const pending = replica.prepare({
      sliceMs: 0,
      yieldToHost: gate.yieldToHost,
    });
    expect(gate.yields).toBe(1);
    expect(replica.isPrepared()).toBe(false);
    replica.insert(0, "!");
    gate.release();

    // Assert
    await expect(pending).resolves.toBeUndefined();
    expect(gate.yields).toBe(1);
    expect(replica.getText()).toBe(`!${source.getText()}`);
    expect(replica.getReplayStats().snapshotValidationReplays).toBe(1);
  });

  it("rejects with the error an operation hit while finishing it", async () => {
    // Arrange
    const snapshot = codec.decode(
      untrustedBytes(concurrentHistory().createPortableSnapshot()),
    );
    const replica = EgWalkerReplica.fromPortableSnapshot({
      ...snapshot,
      text: `${snapshot.text}?`,
    });
    const gate = gatedYield();
    const pending = replica.prepare({
      sliceMs: 0,
      yieldToHost: gate.yieldToHost,
    });

    // Act
    const insert = () => replica.insert(0, "!");

    // Assert
    expect(insert).toThrow(/materialized text mismatch/);
    gate.release();
    await expect(pending).rejects.toThrow(/materialized text mismatch/);
    expect(replica.isPrepared()).toBe(false);
  });

  it("shares one preparation between calls made while it runs", async () => {
    // Arrange
    const replica = restore(
      untrustedBytes(concurrentHistory().createPortableSnapshot()),
    );

    // Act
    const first = replica.prepare({ sliceMs: 0 });
    const second = replica.prepare();
    await first;

    // Assert
    expect(second).toBe(first);
    expect(replica.getReplayStats().snapshotValidationReplays).toBe(1);
  });

  it("abandons the preparation on abort and starts over on the next call", async () => {
    // Arrange
    const source = concurrentHistory();
    const snapshot = codec.decode(
      untrustedBytes(source.createPortableSnapshot()),
    );
    const replica = EgWalkerReplica.fromPortableSnapshot(snapshot, "reader");
    const controller = new AbortController();
    const reason = new Error("document closed");

    // Act
    const aborted = replica.prepare({
      sliceMs: 0,
      signal: controller.signal,
      yieldToHost: () => {
        controller.abort(reason);
        return Promise.resolve();
      },
    });

    // Assert
    await expect(aborted).rejects.toBe(reason);
    expect(replica.isPrepared()).toBe(false);
    expect(replica.getText()).toBe(snapshot.text);
    await replica.prepare();
    expect(replica.isPrepared()).toBe(true);
    expect(replica.getText()).toBe(source.getText());
    expect(replica.getReplayStats().snapshotValidationReplays).toBe(1);
  });

  it("does not start for a signal that is already aborted", async () => {
    // Arrange
    const replica = restore(
      untrustedBytes(concurrentHistory().createPortableSnapshot()),
    );
    const decodeSteps = vi.spyOn(
      ColumnarEventGraphCodec.prototype,
      "decodeBinarySteps",
    );

    try {
      // Act
      const pending = replica.prepare({ signal: AbortSignal.abort() });

      // Assert
      await expect(pending).rejects.toThrow();
      expect(decodeSteps).not.toHaveBeenCalled();
      expect(replica.isPrepared()).toBe(false);
    } finally {
      decodeSteps.mockRestore();
    }
  });

  it("resolves at once for a replica that is already prepared", async () => {
    // Arrange
    const replica = new EgWalkerReplica("author", "seed");
    const host = countingYield();

    // Act
    await replica.prepare({ yieldToHost: host.yieldToHost });

    // Assert
    expect(replica.isPrepared()).toBe(true);
    expect(host.yields).toBe(0);
  });

  it("only decodes a snapshot from live state in this process", async () => {
    // Arrange
    const source = concurrentHistory();
    const replica = EgWalkerReplica.fromPortableSnapshot(
      source.createPortableSnapshot(),
      "reader",
    );
    const generatedInSteps = vi.spyOn(
      EgWalkerEngine.prototype,
      "generatePackedSectionRangeSteps",
    );

    try {
      // Act
      expect(replica.isPrepared()).toBe(false);
      await replica.prepare({ sliceMs: 0 });

      // Assert
      expect(replica.isPrepared()).toBe(true);
      expect(generatedInSteps).not.toHaveBeenCalled();
      expect(replica.getReplayStats().snapshotValidationReplays).toBe(0);
      replica.insert(0, "!");
      expect(replica.getText()).toBe(`!${source.getText()}`);
    } finally {
      generatedInSteps.mockRestore();
    }
  });

  it("decodes a lazily restored native snapshot", async () => {
    // Arrange
    const source = concurrentHistory();
    const nativeCodec = new NativeSnapshotCodec();
    const replica = EgWalkerReplica.fromNativeSnapshot(
      nativeCodec.decode(
        nativeCodec.encode(
          source.createNativeSnapshot({ resumeCache: "none" }),
        ),
      ),
      "reader",
    );

    // Act
    expect(replica.isPrepared()).toBe(false);
    await replica.prepare({ sliceMs: 0 });

    // Assert
    expect(replica.isPrepared()).toBe(true);
    expect(replica.exportEventGraph()).toEqual(source.exportEventGraph());
  });

  it.each([
    ["scheduler.yield()", "scheduler"],
    ["a MessageChannel message", "MessageChannel"],
    ["setTimeout", "setTimeout"],
  ] as const)("yields to the host through %s when nothing earlier is available", async (_name, via) => {
    // Arrange: hide what the default would pick before `via`.
    const used = vi.fn();
    const Channel = MessageChannel;
    const delay = setTimeout;
    if (via === "scheduler") {
      vi.stubGlobal("scheduler", {
        yield: () => {
          used();
          return Promise.resolve();
        },
      });
    } else {
      vi.stubGlobal("setImmediate", undefined);
    }
    if (via === "MessageChannel") {
      vi.stubGlobal(
        "MessageChannel",
        class extends Channel {
          constructor() {
            super();
            used();
          }
        },
      );
    }
    if (via === "setTimeout") {
      vi.stubGlobal("MessageChannel", undefined);
      vi.stubGlobal("setTimeout", (callback: () => void, ms?: number) => {
        used();
        return delay(callback, ms);
      });
    }
    const replica = restore(
      untrustedBytes(linearHistory().createPortableSnapshot()),
    );

    try {
      // Act
      await replica.prepare({ sliceMs: 0 });
    } finally {
      vi.unstubAllGlobals();
    }

    // Assert
    expect(used).toHaveBeenCalled();
    expect(replica.isPrepared()).toBe(true);
  });

  it("rejects invalid options without starting", async () => {
    // Arrange
    const replica = restore(
      untrustedBytes(concurrentHistory().createPortableSnapshot()),
    );

    // Act and assert
    await expect(replica.prepare({ sliceMs: -1 })).rejects.toThrow(RangeError);
    await expect(replica.prepare({ sliceMs: Number.NaN })).rejects.toThrow(
      RangeError,
    );
    await expect(
      replica.prepare({ yieldToHost: "soon" as never }),
    ).rejects.toThrow(TypeError);
    expect(replica.isPrepared()).toBe(false);
  });
});
