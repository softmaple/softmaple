/**
 * A burst of concurrent edits from one peer after opening a persisted
 * document, either by a cold load of its decoded graph or with
 * `EgWalkerReplica.fromPortableSnapshot`.
 *
 * The peer diverged `depth` events before the end of the document's event
 * order and sends one insert after another, each on top of its previous one.
 * The first edit pays for the merge: a partial replay from the newest
 * checkpoint before the divergence, after the lazy graph decode and text
 * validation for a portable snapshot. Every later edit is concurrent with the
 * same history, so it stays cheap only while the replica keeps the replay
 * state the first edit built. The harness times every edit, reads the replay
 * counters after it, and samples the heap and array buffers after GC once
 * the document is open and again after the burst, with the replica alive.
 *
 * The module only imports eg-walker types. The implementation under test is
 * passed in, so one harness can measure a base and a head build.
 */
import { performance } from "node:perf_hooks";

import type {
  EventId,
  GraphEvent,
  PortableSnapshot,
} from "@softmaple/eg-walker";

import {
  buildWarmUpSnapshot,
  sha256Hex,
  type SnapshotFirstEditApi,
  type SnapshotFirstEditManifest,
} from "./snapshot-first-edit";

type EgWalkerModule = typeof import("@softmaple/eg-walker");
type Replica = InstanceType<EgWalkerModule["EgWalkerReplica"]>;

export type ConcurrentBurstApi = SnapshotFirstEditApi;

export const CONCURRENT_BURST_OPENS = ["native", "portable"] as const;

/**
 * - `native`: decode the snapshot's graph and replay it into a fresh replica,
 *   the `nativeLoadMs` lane of `paper-bench --native-only`.
 * - `portable`: `EgWalkerReplica.fromPortableSnapshot`, which decodes and
 *   validates the graph lazily, during the first edit.
 */
export type ConcurrentBurstOpen = (typeof CONCURRENT_BURST_OPENS)[number];

export const parseConcurrentBurstOpen = (
  value: string,
): ConcurrentBurstOpen => {
  const open = CONCURRENT_BURST_OPENS.find((candidate) => candidate === value);
  if (open === undefined) {
    throw new Error(
      `Unknown open mode ${JSON.stringify(value)}; expected ${CONCURRENT_BURST_OPENS.join(" or ")}`,
    );
  }
  return open;
};

export interface ConcurrentBurstOptions {
  readonly open: ConcurrentBurstOpen;
  /** Events between the peer's divergence point and the end of the history. */
  readonly depth: number;
  /** Consecutive inserts the peer sends. */
  readonly edits: number;
  /** Forces a full collection; `globalThis.gc` under `--expose-gc`. */
  readonly collectGarbage?: () => void;
  readonly memoryUsage?: () => Pick<
    NodeJS.MemoryUsage,
    "heapUsed" | "arrayBuffers" | "rss"
  >;
}

/** One edit of the burst and the replica's replay state right after it. */
export interface ConcurrentBurstEdit {
  readonly ms: number;
  readonly lastReplaySource: string | null;
  /** Full and partial replays and incremental applies this edit ran. */
  readonly fullReplays: number;
  readonly partialReplays: number;
  readonly incrementalApplies: number;
  /** Events the retained replay cache covers; 0 when the replica keeps none. */
  readonly replayCacheEvents: number;
  /** The replica's own estimate of that cache, which its budget limits. */
  readonly replayCacheBytes: number;
  /**
   * The edit replayed history or started with a cache, and ended without
   * one: the cache was released at the byte budget or at a critical cut.
   */
  readonly cacheReleased: boolean;
}

export interface ConcurrentBurstResult {
  readonly open: ConcurrentBurstOpen;
  readonly depth: number;
  /** Portable container decode, the same for both open modes. */
  readonly decodeMs: number;
  /** Cold load (graph decode and replay) or `fromPortableSnapshot`. */
  readonly openMs: number;
  readonly edits: ReadonlyArray<ConcurrentBurstEdit>;
  readonly heapAfterOpenBytes: number;
  readonly arrayBuffersAfterOpenBytes: number;
  /** After GC at the end of the burst, with the replica still alive. */
  readonly heapAfterEditsBytes: number;
  readonly arrayBuffersAfterEditsBytes: number;
  readonly rssAfterEditsBytes: number;
  readonly finalTextLength: number;
  readonly finalTextSha256: string;
  readonly finalTextValidated: true;
}

const PEER_ID = "bench-burst-peer";
const MARKER_BASE = 0xe000;

/** A private-use character per edit, so the merged text can be checked. */
export const burstMarker = (edit: number): string =>
  String.fromCharCode(MARKER_BASE + edit);

/**
 * The peer's inserts, each at the start of the peer's own document and on
 * top of its previous insert, the first on top of `ancestor`.
 */
export const burstEvents = (
  ancestor: EventId,
  edits: number,
): ReadonlyArray<GraphEvent> =>
  Array.from({ length: edits }, (_, edit) => ({
    id: `${PEER_ID}:${edit}`,
    parentVersion: new Set([edit === 0 ? ancestor : `${PEER_ID}:${edit - 1}`]),
    operation: { type: "insert", index: 0, text: burstMarker(edit) },
    timestamp: edit + 1,
  }));

/**
 * Every marker appears once, each in front of the one typed before it, and
 * removing them restores the snapshot text.
 */
export const assertBurstText = (
  text: string,
  snapshotText: string,
  edits: number,
): void => {
  let stripped = text;
  let previousPosition = Number.POSITIVE_INFINITY;
  for (let edit = 0; edit < edits; edit++) {
    const marker = burstMarker(edit);
    const position = text.indexOf(marker);
    if (position === -1 || text.indexOf(marker, position + 1) !== -1) {
      throw new Error(`burst marker ${edit} is missing or duplicated`);
    }
    if (position > previousPosition) {
      throw new Error(`burst marker ${edit} is behind an earlier marker`);
    }
    previousPosition = position;
    stripped = stripped.replace(marker, "");
  }
  if (stripped !== snapshotText) {
    throw new Error("text without the burst markers differs from the snapshot");
  }
};

const assertBurstFitsSnapshot = (
  snapshotText: string,
  manifest: SnapshotFirstEditManifest,
  edits: number,
): void => {
  if (!Number.isSafeInteger(edits) || edits < 1 || edits > 64) {
    throw new Error(`edits must be an integer from 1 to 64, got ${edits}`);
  }
  if (
    snapshotText.length !== manifest.textLength ||
    sha256Hex(snapshotText) !== manifest.textSha256
  ) {
    throw new Error(`${manifest.label}: snapshot does not match its manifest`);
  }
  for (let edit = 0; edit < edits; edit++) {
    if (snapshotText.includes(burstMarker(edit))) {
      throw new Error(`${manifest.label}: snapshot text contains a marker`);
    }
  }
};

const requireAncestor = (
  manifest: SnapshotFirstEditManifest,
  depth: number,
): EventId => {
  const ancestor = manifest.ancestorsByDepth[String(depth)];
  if (ancestor === undefined) {
    throw new Error(
      `${manifest.label}: no ancestor prepared for depth ${depth}; prepare it with --depths`,
    );
  }
  return ancestor;
};

const openReplica = (
  api: ConcurrentBurstApi,
  snapshot: PortableSnapshot,
  open: ConcurrentBurstOpen,
): Replica => {
  if (open === "portable") {
    return api.EgWalkerReplica.fromPortableSnapshot(snapshot, "bench-portable");
  }
  const graph = new api.ColumnarEventGraphCodec().decodeBinary(
    snapshot.eventGraph.slice(),
  );
  return new api.EgWalkerReplica("bench-native", snapshot.initialText, graph);
};

/**
 * Open `bytes`, then apply the peer's burst one event at a time. `bytes` is
 * copied before decode, so every call opens a fresh persistence boundary.
 */
export const measureConcurrentBurst = (
  api: ConcurrentBurstApi,
  bytes: Uint8Array,
  manifest: SnapshotFirstEditManifest,
  options: ConcurrentBurstOptions,
): ConcurrentBurstResult => {
  const { open, depth, edits } = options;
  const collectGarbage = options.collectGarbage ?? (() => undefined);
  const memoryUsage = options.memoryUsage ?? (() => process.memoryUsage());
  const settle = () => {
    collectGarbage();
    collectGarbage();
    return memoryUsage();
  };
  const events = burstEvents(requireAncestor(manifest, depth), edits);

  settle();
  let startedAt = performance.now();
  const snapshot = new api.PortableSnapshotCodec().decode(bytes.slice());
  const decodeMs = performance.now() - startedAt;
  assertBurstFitsSnapshot(snapshot.text, manifest, edits);

  settle();
  startedAt = performance.now();
  const replica = openReplica(api, snapshot, open);
  const openMs = performance.now() - startedAt;
  if (
    open === "native" &&
    sha256Hex(replica.getText()) !== manifest.textSha256
  ) {
    throw new Error(`${manifest.label}: cold load text mismatch`);
  }
  const afterOpen = settle();

  const results: ConcurrentBurstEdit[] = [];
  let cacheBefore = replica.getReplayStats().replayCacheBytes > 0;
  for (const event of events) {
    const before = replica.getReplayStats();
    startedAt = performance.now();
    const result = replica.applyRemoteEvent(event);
    const ms = performance.now() - startedAt;
    if (result.status !== "integrated") {
      throw new Error(`burst edit ${event.id} was ${result.status}`);
    }
    const after = replica.getReplayStats();
    const fullReplays = after.fullReplays - before.fullReplays;
    const partialReplays = after.partialReplays - before.partialReplays;
    const cacheAfter = after.replayCacheBytes > 0;
    results.push({
      ms,
      lastReplaySource: after.lastReplaySource,
      fullReplays,
      partialReplays,
      incrementalApplies: after.incrementalApplies - before.incrementalApplies,
      replayCacheEvents: after.replayCacheEvents,
      replayCacheBytes: after.replayCacheBytes,
      cacheReleased:
        (fullReplays + partialReplays > 0 || cacheBefore) && !cacheAfter,
    });
    cacheBefore = cacheAfter;
  }

  const text = replica.getText();
  assertBurstText(text, snapshot.text, edits);
  const afterEdits = settle();
  return {
    open,
    depth,
    decodeMs,
    openMs,
    edits: results,
    heapAfterOpenBytes: afterOpen.heapUsed,
    arrayBuffersAfterOpenBytes: afterOpen.arrayBuffers,
    heapAfterEditsBytes: afterEdits.heapUsed,
    arrayBuffersAfterEditsBytes: afterEdits.arrayBuffers,
    rssAfterEditsBytes: afterEdits.rss,
    finalTextLength: text.length,
    finalTextSha256: sha256Hex(text),
    finalTextValidated: true,
  };
};

/**
 * Run short bursts on the {@link buildWarmUpSnapshot} history in both open
 * modes, so the measured burst does not include first-call compilation of the
 * replay and incremental paths every document shares.
 */
export const warmUpConcurrentBurst = (
  api: ConcurrentBurstApi,
  edits: number,
  iterations: number = 2,
): void => {
  const { bytes, manifest, depths } = buildWarmUpSnapshot(api);
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const open of CONCURRENT_BURST_OPENS) {
      for (const depth of depths) {
        measureConcurrentBurst(api, bytes, manifest, { open, depth, edits });
      }
    }
  }
};
