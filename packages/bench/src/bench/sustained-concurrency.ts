/**
 * Live typing under sustained concurrency.
 *
 * `writers` replicas each type one letter per step at their own cursor, and
 * every edit reaches the other writers and a relay, which never types, one to
 * `maxDelaySteps` steps later. So an edit is always in flight, and after the
 * first steps
 * the history has no critical version: a replica that drops its replay cache
 * can only rebuild it by replaying the whole history. The edits that arrive
 * from one writer in a step reach a replica either one `applyRemoteEvent`
 * call at a time or as one `applyRemoteEvents` batch.
 *
 * The harness times every replica call, local inserts and receives, and the
 * relay's receives on their own. Outside the timer it checks that every
 * replica converges on the same text with every typed letter, and it reports
 * a digest of the text so a driver can require every build and API to
 * converge on the same document. The schedule depends only on the seed and on
 * what each replica has received, so it is the same for every build.
 *
 * Every eg-walker function the measurement calls comes from the
 * implementation passed in, so one harness can measure a base and a head
 * build.
 */
import { performance } from "node:perf_hooks";

import type { GraphEvent } from "@softmaple/eg-walker";

import { textDigest } from "./wide-frontier";

type EgWalkerModule = typeof import("@softmaple/eg-walker");

export type SustainedConcurrencyApi = Pick<EgWalkerModule, "EgWalkerReplica">;

type Replica = InstanceType<SustainedConcurrencyApi["EgWalkerReplica"]>;

/** How the edits that arrive together reach a replica. */
export const SUSTAINED_CONCURRENCY_APPLY = {
  /** One `applyRemoteEvent` call per edit. */
  Single: "single",
  /** One `applyRemoteEvents` call per writer and step. */
  Batch: "batch",
} as const;
export type SustainedConcurrencyApply =
  (typeof SUSTAINED_CONCURRENCY_APPLY)[keyof typeof SUSTAINED_CONCURRENCY_APPLY];

export interface SustainedConcurrencyOptions {
  readonly writers: number;
  /** Letters typed by all writers together. */
  readonly events: number;
  /** The latest step an edit can arrive after the one it was typed in. */
  readonly maxDelaySteps: number;
  readonly apply: SustainedConcurrencyApply;
  /**
   * Letters in one untimed session of the same shape before the measured
   * one, or 0 for none.
   */
  readonly warmupEvents: number;
}

export interface SustainedConcurrencyResult {
  readonly writers: number;
  readonly events: number;
  readonly maxDelaySteps: number;
  readonly apply: SustainedConcurrencyApply;
  /** Time in every replica call: local inserts and receives. */
  readonly totalMs: number;
  /** Time in every receive call, the relay's included. */
  readonly receiveMs: number;
  /** Time in the relay's receive calls. */
  readonly relayReceiveMs: number;
  /** `totalMs` per typed letter. */
  readonly perEventUs: number;
  readonly textLength: number;
  /** FNV-1a digest of the final text, as 8 hex digits. */
  readonly textDigest: string;
  /** Replay counters summed over the writers and the relay. */
  readonly fullReplays: number;
  readonly partialReplays: number;
  readonly replayCacheEvictions: number;
}

/** Chance that a writer moves its cursor before typing. */
const CURSOR_JUMP_CHANCE = 0.03;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

/** The letter typed as the `index`th edit of a session. */
const letterOf = (index: number): string => ALPHABET[index % ALPHABET.length]!;

/** A deterministic generator of numbers in `[0, 1)`. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const assertCount = (value: number, minimum: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer of at least ${minimum}`);
  }
};

interface InFlightEdit {
  /** Step the edit arrives in. */
  readonly at: number;
  readonly event: GraphEvent;
}

const runRound = (
  api: SustainedConcurrencyApi,
  options: SustainedConcurrencyOptions,
  count: number,
): SustainedConcurrencyResult => {
  const { writers, maxDelaySteps, apply } = options;
  const relay = writers;
  const replicas: Replica[] = Array.from(
    { length: writers + 1 },
    (_, index) =>
      new api.EgWalkerReplica(
        index === relay ? "relay" : `writer-${String(index).padStart(3, "0")}`,
      ),
  );
  const random = seededRandom(
    writers * 7_919 + maxDelaySteps * 104_729 + count,
  );
  /** In-flight edits for each recipient, by sender, in send order. */
  const inbox = replicas.map(() =>
    Array.from({ length: writers }, (): InFlightEdit[] => []),
  );
  const lengths = replicas.map(() => 0);
  const cursors = replicas.map(() => 0);
  let localMs = 0;
  let receiveMs = 0;
  let relayReceiveMs = 0;

  const deliver = (recipient: number, step: number): void => {
    const replica = replicas[recipient]!;
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
      const start = performance.now();
      if (apply === SUSTAINED_CONCURRENCY_APPLY.Single) {
        for (const event of arrived) {
          replica.applyRemoteEvent(event);
        }
      } else {
        replica.applyRemoteEvents(arrived);
      }
      const elapsed = performance.now() - start;
      receiveMs += elapsed;
      if (recipient === relay) {
        relayReceiveMs += elapsed;
      }
      // Every edit inserts one letter.
      lengths[recipient]! += arrived.length;
    }
  };

  let typed = 0;
  for (let step = 1; typed < count; step++) {
    for (let recipient = 0; recipient < replicas.length; recipient++) {
      deliver(recipient, step);
    }
    for (let writer = 0; writer < writers && typed < count; writer++) {
      if (random() < CURSOR_JUMP_CHANCE) {
        cursors[writer] = Math.floor(random() * (lengths[writer]! + 1));
      }
      const cursor = Math.min(cursors[writer]!, lengths[writer]!);
      const start = performance.now();
      const event = replicas[writer]!.insert(cursor, letterOf(typed));
      localMs += performance.now() - start;
      if (event === null) {
        throw new Error(`writer ${writer} made no edit at ${cursor}`);
      }
      cursors[writer] = cursor + 1;
      lengths[writer]!++;
      typed++;
      for (let recipient = 0; recipient < replicas.length; recipient++) {
        if (recipient !== writer) {
          inbox[recipient]![writer]!.push({
            at: step + 1 + Math.floor(random() * maxDelaySteps),
            event,
          });
        }
      }
    }
  }
  for (let recipient = 0; recipient < replicas.length; recipient++) {
    deliver(recipient, Number.POSITIVE_INFINITY);
  }

  const text = replicas[relay]!.getText();
  for (const [index, replica] of replicas.entries()) {
    if (replica.getText() !== text) {
      throw new Error(`replica ${index} diverged from the relay`);
    }
  }
  assertTypedLetters(text, count);
  const stats = replicas.map((replica) => replica.getReplayStats());
  const sum = (read: (stat: (typeof stats)[number]) => number): number =>
    stats.reduce((total, stat) => total + read(stat), 0);
  const totalMs = localMs + receiveMs;
  return {
    writers,
    events: count,
    maxDelaySteps,
    apply,
    totalMs,
    receiveMs,
    relayReceiveMs,
    perEventUs: (totalMs * 1_000) / count,
    textLength: text.length,
    textDigest: textDigest(text),
    fullReplays: sum((stat) => stat.fullReplays),
    partialReplays: sum((stat) => stat.partialReplays),
    replayCacheEvictions: sum((stat) => stat.replayCacheEvictions),
  };
};

/** Throw unless `text` holds exactly the letters of `count` typed edits. */
const assertTypedLetters = (text: string, count: number): void => {
  if (text.length !== count) {
    throw new Error(`text has ${text.length} of ${count} letters`);
  }
  const typed = new Map<string, number>();
  for (let index = 0; index < count; index++) {
    const letter = letterOf(index);
    typed.set(letter, (typed.get(letter) ?? 0) + 1);
  }
  const received = new Map<string, number>();
  for (const letter of text) {
    received.set(letter, (received.get(letter) ?? 0) + 1);
  }
  // With the lengths equal, no other letter can be in the text.
  for (const [letter, expected] of typed) {
    const actual = received.get(letter) ?? 0;
    if (actual !== expected) {
      throw new Error(`text has ${actual} of ${expected} typed ${letter}`);
    }
  }
};

export const measureSustainedConcurrency = (
  api: SustainedConcurrencyApi,
  options: SustainedConcurrencyOptions,
): SustainedConcurrencyResult => {
  assertCount(options.writers, 2, "writer count");
  assertCount(options.events, 1, "event count");
  assertCount(options.maxDelaySteps, 1, "maximum delay");
  assertCount(options.warmupEvents, 0, "warm-up event count");
  if (!Object.values(SUSTAINED_CONCURRENCY_APPLY).includes(options.apply)) {
    throw new Error(`unknown apply API ${String(options.apply)}`);
  }
  if (options.warmupEvents > 0) {
    runRound(api, options, options.warmupEvents);
  }
  return runRound(api, options, options.events);
};
