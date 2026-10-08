import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import type { GraphEvent } from "../types";

/**
 * Under sustained concurrency every writer types while edits are in flight,
 * so after the first steps the history has no critical version: a replica
 * that drops its replay cache can only rebuild it by replaying the whole
 * history. These sessions run past REPLAY_CACHE_CRITICAL_RELEASE_EVENTS
 * events, where a large cache becomes eligible for release.
 */
describe("sustained concurrency", () => {
  it.each([
    { writers: 2, apply: "single" },
    { writers: 3, apply: "batch" },
  ] as const)("should keep each writer's replay cache warm ($writers writers, $apply)", ({
    writers,
    apply,
  }) => {
    // Arrange
    const session = typingSession({ writers, events: 5_000, apply });

    // Act
    session.run();

    // Assert
    expect(new Set(session.replicas.map(textOf)).size).toBe(1);
    for (const replica of session.replicas) {
      expect(replica.getReplayStats()).toMatchObject({
        fullReplays: 1,
        partialReplays: 0,
        replayCacheEvictions: 0,
      });
    }
  }, 30_000);

  it.each([
    "single",
    "batch",
  ] as const)("should keep a relay's replay cache warm while writers type ($0)", (apply) => {
    // Arrange: a relay receives every writer's edits and never types. Its
    // frontier is a single event whenever the last edit it received follows
    // all the others, and a writer's edits extend it as a chain whenever the
    // writer had seen just what the relay holds.
    const session = typingSession({
      writers: 2,
      events: 5_000,
      apply,
      relays: 1,
    });

    // Act
    session.run();

    // Assert
    const [writer, , relay] = session.replicas as [
      EgWalkerReplica,
      EgWalkerReplica,
      EgWalkerReplica,
    ];
    expect(relay.getText()).toBe(writer.getText());
    expect(relay.getReplayStats()).toMatchObject({
      fullReplays: 1,
      partialReplays: 0,
      replayCacheEvictions: 0,
    });
  }, 30_000);

  it("should release the cache once every writer has built on a merge", () => {
    // Arrange
    const session = typingSession({
      writers: 2,
      events: 5_000,
      apply: "single",
    });
    session.run();
    const [first, second] = session.replicas as [
      EgWalkerReplica,
      EgWalkerReplica,
    ];

    // Act: the first writer merges everything, the second receives the merge
    // and builds on it, and the first receives that.
    const merge = first.insert(0, "m")!;
    const atMerge = first.getReplayStats();
    second.applyRemoteEvent(merge);
    first.applyRemoteEvent(second.insert(0, "n")!);

    // Assert: the first writer keeps its cache until the second has built on
    // the merge. The second knows at once that both have: the first wrote
    // the merge, and the second's own edits follow it.
    expect(atMerge).toMatchObject({ replayCacheEvictions: 0 });
    expect(atMerge.replayCacheEvents).toBeGreaterThan(4_096);
    for (const replica of [first, second]) {
      expect(replica.getReplayStats()).toMatchObject({
        replayCacheEvents: 0,
        replayCacheEvictions: 1,
      });
    }
    expect(first.getText()).toBe(second.getText());
  }, 30_000);
});

// Helpers

interface TypingSessionOptions {
  readonly writers: number;
  /** Edits typed in all. */
  readonly events: number;
  /** Whether a sender's edits that arrive together are applied as a batch. */
  readonly apply: "single" | "batch";
  /** Replicas that receive every writer's edits but never type. */
  readonly relays?: number;
}

interface TypingSession {
  /** The writers, then the relays. */
  readonly replicas: ReadonlyArray<EgWalkerReplica>;
  /** Type and deliver until every edit is typed and has arrived. */
  run(): void;
}

/**
 * Writers that each insert one letter per step at their own cursor. An edit
 * reaches every other replica one to four steps later, so an edit is always
 * in flight.
 */
const typingSession = ({
  writers,
  events,
  apply,
  relays = 0,
}: TypingSessionOptions): TypingSession => {
  const replicas = Array.from(
    { length: writers + relays },
    (_unused, index) =>
      new EgWalkerReplica(
        index < writers ? `writer${index}` : `relay${index - writers}`,
      ),
  );
  const random = seededRandom(writers * 7_919 + relays * 104_729 + events);
  /** In-flight edits for each recipient, by sender, in send order. */
  const inbox = replicas.map(() =>
    replicas.map((): Array<{ at: number; event: GraphEvent }> => []),
  );
  const lengths = replicas.map(() => 0);
  const cursors = replicas.map(() => 0);

  const deliver = (recipient: number, step: number): void => {
    for (let sender = 0; sender < writers; sender++) {
      const queue = inbox[recipient]![sender]!;
      let due = 0;
      while (due < queue.length && queue[due]!.at <= step) {
        due++;
      }
      if (due === 0) {
        continue;
      }
      const arrived = queue.splice(0, due).map(({ event }) => event);
      if (apply === "batch") {
        replicas[recipient]!.applyRemoteEvents(arrived);
      } else {
        for (const event of arrived) {
          replicas[recipient]!.applyRemoteEvent(event);
        }
      }
      for (const event of arrived) {
        if (event.operation.type === OPERATION_TYPE.INSERT) {
          lengths[recipient]! += event.operation.text.length;
        }
      }
    }
  };

  return {
    replicas,
    run: () => {
      let typed = 0;
      let step = 0;
      while (typed < events) {
        step++;
        for (let recipient = 0; recipient < replicas.length; recipient++) {
          deliver(recipient, step);
        }
        for (let writer = 0; writer < writers && typed < events; writer++) {
          if (random() < 0.03) {
            cursors[writer] = Math.floor(random() * (lengths[writer]! + 1));
          }
          const cursor = Math.min(cursors[writer]!, lengths[writer]!);
          const event = replicas[writer]!.insert(cursor, letter(typed))!;
          cursors[writer] = cursor + 1;
          lengths[writer]!++;
          typed++;
          for (let recipient = 0; recipient < replicas.length; recipient++) {
            if (recipient !== writer) {
              inbox[recipient]![writer]!.push({
                at: step + 1 + Math.floor(random() * 4),
                event,
              });
            }
          }
        }
      }
      for (let recipient = 0; recipient < replicas.length; recipient++) {
        deliver(recipient, Number.POSITIVE_INFINITY);
      }
    },
  };
};

const textOf = (replica: EgWalkerReplica): string => replica.getText();

const letter = (index: number): string =>
  String.fromCharCode(0x61 + (index % 26));

/** A deterministic generator of numbers in `[0, 1)`. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};
