/**
 * First-edit latency after opening a persisted document with
 * `EgWalkerReplica.fromPortableSnapshot`.
 *
 * Opening a portable snapshot is lazy: the event graph is decoded and the
 * snapshot text is validated by the first operation that needs history. This
 * module times that first operation and the one after it for one edit kind.
 * Each kind must run in a fresh process, because once the first edit has paid
 * for the lazy work every later operation measures something else.
 *
 * The module only imports eg-walker types. The implementation under test is
 * passed in, so one harness can measure a base and a head build.
 */
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import type {
  EventId,
  GraphEvent,
  PortableSnapshot,
} from "@softmaple/eg-walker";

type EgWalkerModule = typeof import("@softmaple/eg-walker");
type EgWalkerInternalModule = typeof import("@softmaple/eg-walker/internal");

export type SnapshotFirstEditApi = Pick<
  EgWalkerModule,
  "EgWalkerReplica" | "PortableSnapshotCodec"
> &
  Pick<EgWalkerInternalModule, "ColumnarEventGraphCodec">;

/** Private-use characters, so the edited text can be checked exactly. */
export const FIRST_EDIT_MARKER = "";
export const SECOND_EDIT_MARKER = "";

/**
 * - `local`: two local inserts.
 * - `remote`: a caught-up peer sends two events that extend the frontier.
 * - `concurrent`: a peer that diverged `depth` events before the end of the
 *   snapshot's event order sends an event, then a second one on top of it.
 * - `native`: cold load of the snapshot's own EGW3 payload through
 *   `new EgWalkerReplica(id, initialText, graph)`, the `nativeLoadMs` lane of
 *   `paper-bench --native-only`, measured on the same bytes and process
 *   setup as the edit lanes.
 */
export type SnapshotEditKind =
  | { readonly type: "local" }
  | { readonly type: "remote" }
  | { readonly type: "concurrent"; readonly depth: number }
  | { readonly type: "native" };

export const parseSnapshotEditKind = (value: string): SnapshotEditKind => {
  if (value === "local" || value === "remote" || value === "native") {
    return { type: value };
  }
  const match = /^concurrent-(\d+)$/.exec(value);
  if (match !== null) {
    const depth = Number(match[1]);
    if (Number.isSafeInteger(depth) && depth >= 0) {
      return { type: "concurrent", depth };
    }
  }
  throw new Error(
    `Unknown snapshot edit kind ${JSON.stringify(value)}; expected local, remote, native, or concurrent-<depth>`,
  );
};

export const formatSnapshotEditKind = (kind: SnapshotEditKind): string =>
  kind.type === "concurrent" ? `concurrent-${kind.depth}` : kind.type;

/** Metadata stored next to a prepared snapshot; never part of timing. */
export interface SnapshotFirstEditManifest {
  readonly label: string;
  readonly eventCount: number;
  readonly frontier: ReadonlyArray<EventId>;
  readonly textLength: number;
  readonly textSha256: string;
  readonly snapshotBytes: number;
  /**
   * `ancestorsByDepth[d]` is the event `d` positions before the end of the
   * snapshot's event order. A peer whose version is that single event has
   * seen it and its causal past, and diverged from the rest.
   */
  readonly ancestorsByDepth: Readonly<Record<string, EventId>>;
}

export interface SnapshotReplayStats {
  readonly snapshotValidationReplays: number;
  readonly fullReplays: number;
  readonly partialReplays: number;
  readonly incrementalApplies: number;
  readonly checkpointCount: number;
  readonly criticalCheckpointHits: number;
  readonly criticalCheckpointMisses: number;
  readonly lastReplaySource: string | null;
  readonly sequenceRecordCount: number;
}

export interface SnapshotFirstEditResult {
  readonly kind: string;
  readonly decodeMs: number;
  readonly restoreMs: number;
  readonly firstEditMs: number;
  readonly secondEditMs: number;
  readonly nativeDecodeMs: number;
  readonly nativeLoadMs: number;
  readonly nativeMaterializeMs: number;
  readonly finalTextLength: number;
  readonly finalTextSha256: string;
  readonly finalTextValidated: true;
  readonly statsAfterFirstEdit: SnapshotReplayStats | null;
  readonly statsAfterSecondEdit: SnapshotReplayStats | null;
  readonly heapAfterGcBytes: number;
}

export const sha256Hex = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/**
 * Exercise every edit lane on a small history built by the implementation
 * under test, so the measured lanes do not include first-call compilation of
 * the code they share with every other document.
 */
export const warmUpSnapshotFirstEdit = (
  api: SnapshotFirstEditApi,
  iterations: number = 2,
): void => {
  const historyLength = 256;
  const source = new api.EgWalkerReplica("bench-warmup");
  const ids: EventId[] = [];
  for (let index = 0; index < historyLength; index++) {
    const event = source.insert(index, "x");
    if (event === null) {
      throw new Error("Warm-up edit was not recorded");
    }
    ids.push(event.id);
  }
  const bytes = new api.PortableSnapshotCodec().encode(
    source.createPortableSnapshot(),
  );
  const text = source.getText();
  const depth = 8;
  const manifest: SnapshotFirstEditManifest = {
    label: "warm-up",
    eventCount: historyLength,
    frontier: [...source.getFrontier()],
    textLength: text.length,
    textSha256: sha256Hex(text),
    snapshotBytes: bytes.byteLength,
    ancestorsByDepth: { [String(depth)]: ids[historyLength - 1 - depth]! },
  };
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const kind of [
      { type: "local" },
      { type: "remote" },
      { type: "concurrent", depth },
      { type: "native" },
    ] as const) {
      measureSnapshotFirstEdit(api, bytes, manifest, kind);
    }
  }
};

/**
 * Time decode, restore, and two edits of one kind, then validate the text.
 * `bytes` is copied before decode, so every call opens a fresh persistence
 * boundary; nothing the caller did with the same bytes is trusted.
 */
export const measureSnapshotFirstEdit = (
  api: SnapshotFirstEditApi,
  bytes: Uint8Array,
  manifest: SnapshotFirstEditManifest,
  kind: SnapshotEditKind,
  collectGarbage: () => void = () => undefined,
): SnapshotFirstEditResult => {
  const codec = new api.PortableSnapshotCodec();
  const persisted = bytes.slice();

  collectGarbage();
  let startedAt = performance.now();
  const snapshot = codec.decode(persisted);
  const decodeMs = performance.now() - startedAt;
  assertSnapshotMatchesManifest(snapshot, manifest);

  if (kind.type === "native") {
    return measureNativeLoad(api, snapshot, manifest, decodeMs, collectGarbage);
  }

  collectGarbage();
  startedAt = performance.now();
  const replica = api.EgWalkerReplica.fromPortableSnapshot(
    snapshot,
    "bench-local",
  );
  const restoreMs = performance.now() - startedAt;

  const [first, second] = buildEdits(kind, manifest);
  startedAt = performance.now();
  first(replica);
  const firstEditMs = performance.now() - startedAt;
  const statsAfterFirstEdit = pickReplayStats(replica.getReplayStats());

  startedAt = performance.now();
  second(replica);
  const secondEditMs = performance.now() - startedAt;
  const statsAfterSecondEdit = pickReplayStats(replica.getReplayStats());

  const text = replica.getText();
  assertEditedText(text, snapshot.text, kind);
  collectGarbage();
  const heapAfterGcBytes = process.memoryUsage().heapUsed;

  return {
    kind: formatSnapshotEditKind(kind),
    decodeMs,
    restoreMs,
    firstEditMs,
    secondEditMs,
    nativeDecodeMs: 0,
    nativeLoadMs: 0,
    nativeMaterializeMs: 0,
    finalTextLength: text.length,
    finalTextSha256: sha256Hex(text),
    finalTextValidated: true,
    statsAfterFirstEdit,
    statsAfterSecondEdit,
    heapAfterGcBytes,
  };
};

type Edit = (replica: InstanceType<EgWalkerModule["EgWalkerReplica"]>) => void;

const PEER_ID = "bench-peer";

const buildEdits = (
  kind: Exclude<SnapshotEditKind, { readonly type: "native" }>,
  manifest: SnapshotFirstEditManifest,
): readonly [Edit, Edit] => {
  if (kind.type === "local") {
    return [
      (replica) => {
        if (replica.insert(0, FIRST_EDIT_MARKER) === null) {
          throw new Error("First local edit was not recorded");
        }
      },
      (replica) => {
        if (replica.insert(0, SECOND_EDIT_MARKER) === null) {
          throw new Error("Second local edit was not recorded");
        }
      },
    ];
  }

  const firstParents =
    kind.type === "remote"
      ? manifest.frontier
      : [requireAncestor(manifest, kind.depth)];
  const firstEvent = remoteInsert(`${PEER_ID}:0`, firstParents, "first");
  const secondEvent = remoteInsert(`${PEER_ID}:1`, [firstEvent.id], "second");
  return [
    (replica) => assertIntegrated(replica.applyRemoteEvent(firstEvent)),
    (replica) => assertIntegrated(replica.applyRemoteEvent(secondEvent)),
  ];
};

const remoteInsert = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  which: "first" | "second",
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: {
    type: "insert",
    index: 0,
    text: which === "first" ? FIRST_EDIT_MARKER : SECOND_EDIT_MARKER,
  },
  timestamp: which === "first" ? 1 : 2,
});

const assertIntegrated = (result: { readonly status: string }): void => {
  if (result.status !== "integrated") {
    throw new Error(`Remote edit was ${result.status}, expected integrated`);
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

const measureNativeLoad = (
  api: SnapshotFirstEditApi,
  snapshot: PortableSnapshot,
  manifest: SnapshotFirstEditManifest,
  decodeMs: number,
  collectGarbage: () => void,
): SnapshotFirstEditResult => {
  const graphCodec = new api.ColumnarEventGraphCodec();
  const eventGraph = snapshot.eventGraph.slice();

  collectGarbage();
  let startedAt = performance.now();
  const graph = graphCodec.decodeBinary(eventGraph);
  const nativeDecodeMs = performance.now() - startedAt;

  collectGarbage();
  startedAt = performance.now();
  const replica = new api.EgWalkerReplica(
    "bench-native",
    snapshot.initialText,
    graph,
  );
  const nativeLoadMs = performance.now() - startedAt;
  startedAt = performance.now();
  const text = replica.getText();
  const nativeMaterializeMs = performance.now() - startedAt;

  if (
    text.length !== manifest.textLength ||
    sha256Hex(text) !== manifest.textSha256
  ) {
    throw new Error(`${manifest.label}: native load text mismatch`);
  }
  collectGarbage();
  const heapAfterGcBytes = process.memoryUsage().heapUsed;

  return {
    kind: "native",
    decodeMs,
    restoreMs: 0,
    firstEditMs: 0,
    secondEditMs: 0,
    nativeDecodeMs,
    nativeLoadMs,
    nativeMaterializeMs,
    finalTextLength: text.length,
    finalTextSha256: manifest.textSha256,
    finalTextValidated: true,
    statsAfterFirstEdit: pickReplayStats(replica.getReplayStats()),
    statsAfterSecondEdit: null,
    heapAfterGcBytes,
  };
};

const assertSnapshotMatchesManifest = (
  snapshot: PortableSnapshot,
  manifest: SnapshotFirstEditManifest,
): void => {
  if (
    snapshot.eventCount !== manifest.eventCount ||
    snapshot.text.length !== manifest.textLength
  ) {
    throw new Error(`${manifest.label}: snapshot does not match its manifest`);
  }
  if (
    snapshot.text.includes(FIRST_EDIT_MARKER) ||
    snapshot.text.includes(SECOND_EDIT_MARKER)
  ) {
    throw new Error(`${manifest.label}: snapshot text contains an edit marker`);
  }
  if (sha256Hex(snapshot.text) !== manifest.textSha256) {
    throw new Error(`${manifest.label}: snapshot text digest mismatch`);
  }
};

/**
 * Local and caught-up remote inserts at index 0 have one exact result. A
 * concurrent insert lands wherever the merge puts it, so check that removing
 * both markers restores the snapshot text and that the second insert, typed
 * in front of the first on the peer, still precedes it.
 */
export const assertEditedText = (
  text: string,
  snapshotText: string,
  kind: SnapshotEditKind,
): void => {
  if (kind.type === "local" || kind.type === "remote") {
    if (text !== `${SECOND_EDIT_MARKER}${FIRST_EDIT_MARKER}${snapshotText}`) {
      throw new Error(`${formatSnapshotEditKind(kind)}: edited text mismatch`);
    }
    return;
  }

  const first = text.indexOf(FIRST_EDIT_MARKER);
  const second = text.indexOf(SECOND_EDIT_MARKER);
  if (
    first === -1 ||
    second === -1 ||
    text.indexOf(FIRST_EDIT_MARKER, first + 1) !== -1 ||
    text.indexOf(SECOND_EDIT_MARKER, second + 1) !== -1 ||
    second > first
  ) {
    throw new Error(
      `${formatSnapshotEditKind(kind)}: edit markers are missing, duplicated, or out of order`,
    );
  }
  const stripped = text
    .replace(FIRST_EDIT_MARKER, "")
    .replace(SECOND_EDIT_MARKER, "");
  if (stripped !== snapshotText) {
    throw new Error(
      `${formatSnapshotEditKind(kind)}: text without the edit markers differs from the snapshot`,
    );
  }
};

const pickReplayStats = (
  stats: ReturnType<
    InstanceType<EgWalkerModule["EgWalkerReplica"]>["getReplayStats"]
  >,
): SnapshotReplayStats => ({
  snapshotValidationReplays: stats.snapshotValidationReplays,
  fullReplays: stats.fullReplays,
  partialReplays: stats.partialReplays,
  incrementalApplies: stats.incrementalApplies,
  checkpointCount: stats.checkpointCount,
  criticalCheckpointHits: stats.criticalCheckpointHits,
  criticalCheckpointMisses: stats.criticalCheckpointMisses,
  lastReplaySource: stats.lastReplaySource,
  sequenceRecordCount: stats.sequenceRecordCount,
});
