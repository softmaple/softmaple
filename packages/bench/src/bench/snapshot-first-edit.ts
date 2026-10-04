/**
 * First-edit latency after opening a persisted document, either with
 * `EgWalkerReplica.fromPortableSnapshot` or by a cold load of its decoded
 * graph.
 *
 * Opening a portable snapshot is lazy: the event graph is decoded and the
 * snapshot text is validated by `replica.prepare()` or, without it, by the
 * first operation that needs history. A cold load replays the history up
 * front and keeps only the checkpoints it recorded on the way, so a peer that
 * diverged far back can still force a long replay. This module times the
 * first operation and the one after it for one edit kind, and the
 * preparation before them for a kind that prepares. Each kind must run in a
 * fresh process, because once the restore work is paid for every later
 * operation measures something else.
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
 * How a `local`, `remote` or `concurrent` lane opens the snapshot before its
 * first edit. Without one, the replica is lazy: the first operation that
 * needs the history decodes and proves it.
 *
 * - `prepared`: `await replica.prepare()`, time-sliced with its default
 *   slice length.
 * - `prepared-whole`: `await replica.prepare({ sliceMs: Infinity })`, in one
 *   task, as a replica hosted in a Worker would.
 * - `trusted`: the bytes are read with `decodeAuthenticated` and the
 *   fixture's tag, then `await replica.prepare()` decodes the history
 *   without replaying it.
 */
export type SnapshotOpenMode = "prepared" | "prepared-whole" | "trusted";

const OPEN_MODES: ReadonlyArray<SnapshotOpenMode> = [
  "prepared-whole",
  "prepared",
  "trusted",
];

/**
 * - `local`: two local inserts.
 * - `remote`: a caught-up peer sends two events that extend the frontier.
 * - `concurrent`: a peer that diverged `depth` events before the end of the
 *   snapshot's event order sends an event, then a second one on top of it.
 * - `native`: cold load of the snapshot's own graph payload through
 *   `new EgWalkerReplica(id, initialText, graph)`, the `nativeLoadMs` lane of
 *   `paper-bench --native-only`, measured on the same bytes and process
 *   setup as the edit lanes.
 * - `native-concurrent`: the same cold load, then the `concurrent` lane's two
 *   inserts. The load is not part of the first edit, so the first edit is
 *   only the merge of a peer that diverged `depth` events back.
 *
 * A `local`, `remote` or `concurrent` lane named with an
 * {@link SnapshotOpenMode} prefix, such as `prepared-local`, opens the
 * snapshot that way.
 */
export type SnapshotEditKind =
  | { readonly type: "local"; readonly open?: SnapshotOpenMode }
  | { readonly type: "remote"; readonly open?: SnapshotOpenMode }
  | {
      readonly type: "concurrent";
      readonly depth: number;
      readonly open?: SnapshotOpenMode;
    }
  | { readonly type: "native" }
  | { readonly type: "native-concurrent"; readonly depth: number };

/** A lane that opens its snapshot with {@link SnapshotOpenMode}. */
export type PreparedSnapshotEditKind = Extract<
  SnapshotEditKind,
  { readonly open?: SnapshotOpenMode }
> & { readonly open: SnapshotOpenMode };

export const parseSnapshotEditKind = (value: string): SnapshotEditKind => {
  const open = OPEN_MODES.find((mode) => value.startsWith(`${mode}-`));
  const lane = open === undefined ? value : value.slice(open.length + 1);
  const opened = <T extends SnapshotEditKind>(kind: T): T =>
    open === undefined ? kind : { ...kind, open };
  if (lane === "local" || lane === "remote") {
    return opened({ type: lane });
  }
  if (lane === "native" && open === undefined) {
    return { type: lane };
  }
  const match = /^(native-)?concurrent-(\d+)$/.exec(lane);
  if (match !== null && (match[1] === undefined || open === undefined)) {
    const depth = Number(match[2]);
    if (Number.isSafeInteger(depth) && depth >= 0) {
      return match[1] === undefined
        ? opened({ type: "concurrent", depth })
        : { type: "native-concurrent", depth };
    }
  }
  throw new Error(
    `Unknown snapshot edit kind ${JSON.stringify(value)}; expected local, remote, native, concurrent-<depth>, or native-concurrent-<depth>, the first three optionally prefixed with prepared-, prepared-whole- or trusted-`,
  );
};

export const formatSnapshotEditKind = (kind: SnapshotEditKind): string => {
  const lane =
    kind.type === "concurrent" || kind.type === "native-concurrent"
      ? `${kind.type}-${kind.depth}`
      : kind.type;
  return "open" in kind && kind.open !== undefined
    ? `${kind.open}-${lane}`
    : lane;
};

export const isPreparedSnapshotEditKind = (
  kind: SnapshotEditKind,
): kind is PreparedSnapshotEditKind =>
  "open" in kind && kind.open !== undefined;

/**
 * The key the `trusted` lanes authenticate their fixtures with. The bench
 * only authenticates bytes it prepared itself, so the key is no secret.
 */
const BENCH_AUTHENTICATION_KEY = new TextEncoder().encode(
  "softmaple snapshot-first-edit bench authentication key",
);

export const importBenchAuthenticationKey = (): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    BENCH_AUTHENTICATION_KEY,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

/** A fixture's authentication tag and the key it verifies under. */
export interface SnapshotAuthentication {
  readonly tag: Uint8Array;
  readonly key: CryptoKey;
}

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
  readonly checkpointUniqueTextBytes: number;
  readonly criticalCheckpointHits: number;
  readonly criticalCheckpointMisses: number;
  readonly lastReplaySource: string | null;
  readonly replayedEvents?: number;
  readonly fullReplayEvents?: number;
  readonly partialReplayEvents?: number;
  readonly lifetimeRetreats?: number;
  readonly lifetimeAdvances?: number;
  readonly replayCacheEvictions?: number;
  readonly replayCacheBudgetRefusals?: number;
  readonly replayCacheBudgetBytes?: number;
  /** Events covered by the retained cache, zero after eviction. */
  readonly replayCacheEvents: number;
  readonly sequenceRecordCount: number;
}

export interface SnapshotFirstEditResult {
  readonly kind: string;
  readonly decodeMs: number;
  readonly restoreMs: number;
  /** `await replica.prepare()`; 0 for a lane that does not prepare. */
  readonly prepareMs: number;
  /** Synchronous runs of preparation work; 0 without `prepare()`. */
  readonly prepareSlices: number;
  /** The longest of those runs: the longest task preparation added. */
  readonly prepareLongestSliceMs: number;
  /**
   * From the snapshot bytes to a replica whose next edit does no restore
   * work: decode and restore, then `prepare()` or, for a lane that does not
   * prepare, the first edit, which does that work. For a cold load, the
   * decode and the load.
   */
  readonly readyToEditMs: number;
  readonly firstEditMs: number;
  readonly secondEditMs: number;
  readonly nativeDecodeMs: number;
  readonly nativeLoadMs: number;
  readonly nativeMaterializeMs: number;
  readonly finalTextLength: number;
  readonly finalTextSha256: string;
  readonly finalTextValidated: true;
  /** Replay state right after a cold load; `null` for snapshot lanes. */
  readonly statsAfterOpen: SnapshotReplayStats | null;
  readonly statsAfterFirstEdit: SnapshotReplayStats | null;
  readonly statsAfterSecondEdit: SnapshotReplayStats | null;
  /** Heap after GC right after a cold load; `null` for snapshot lanes. */
  readonly heapAfterOpenBytes: number | null;
  /** Heap after GC at the end of the lane, with the replica still alive. */
  readonly heapAfterGcBytes: number;
}

export const sha256Hex = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/** A small persisted history for warming up, and its divergence depths. */
export interface WarmUpSnapshot {
  readonly bytes: Uint8Array;
  readonly manifest: SnapshotFirstEditManifest;
  readonly depths: ReadonlyArray<number>;
}

/**
 * Build a small history with the implementation under test and encode it as
 * a portable snapshot, so a warm-up opens it the way a measured lane opens a
 * paper dataset.
 *
 * One author types while a second one occasionally inserts concurrently, so
 * the history has both chains and short nonlinear sections. As in the paper
 * traces, the author types and deletes at a cursor inside the text, so a
 * replay that starts from a checkpoint edits text it did not replay itself.
 * Divergences at a shallow and a deep point reach both a recent checkpoint
 * and an older one with sections of either kind in between.
 */
export const buildWarmUpSnapshot = (
  api: Pick<SnapshotFirstEditApi, "EgWalkerReplica" | "PortableSnapshotCodec">,
): WarmUpSnapshot => {
  const historyLength = 1_024;
  const author = new api.EgWalkerReplica("bench-warmup-a");
  const peer = new api.EgWalkerReplica("bench-warmup-b");
  const ids: EventId[] = [];
  const recorded = (event: GraphEvent | null): GraphEvent => {
    if (event === null) {
      throw new Error("Warm-up edit was not recorded");
    }
    ids.push(event.id);
    return event;
  };
  let cursor = 0;
  while (ids.length < historyLength) {
    const position = ids.length % 200;
    if (position === 100 || position === 116) {
      const mine = recorded(author.insert(0, "a"));
      const theirs = recorded(peer.insert(peer.getText().length, "b"));
      author.applyRemoteEvent(theirs);
      peer.applyRemoteEvent(mine);
      // The author's "a" landed before the cursor.
      cursor++;
      continue;
    }
    if (position % 64 === 0) {
      cursor = Math.floor(author.getText().length / 2);
    }
    if (position % 16 === 15 && cursor > 0) {
      cursor--;
      peer.applyRemoteEvent(recorded(author.delete(cursor, 1)));
      continue;
    }
    peer.applyRemoteEvent(recorded(author.insert(cursor, "x")));
    cursor++;
  }
  const bytes = new api.PortableSnapshotCodec().encode(
    author.createPortableSnapshot(),
  );
  const text = author.getText();
  const depths = [8, 300];
  const manifest: SnapshotFirstEditManifest = {
    label: "warm-up",
    eventCount: ids.length,
    frontier: [...author.getFrontier()],
    textLength: text.length,
    textSha256: sha256Hex(text),
    snapshotBytes: bytes.byteLength,
    ancestorsByDepth: Object.fromEntries(
      depths.map((depth) => [String(depth), ids[ids.length - 1 - depth]!]),
    ),
  };
  return { bytes, manifest, depths };
};

/**
 * Exercise every edit lane on the {@link buildWarmUpSnapshot} history, so
 * the measured lanes do not include first-call compilation of the code they
 * share with every other document.
 */
export const warmUpSnapshotFirstEdit = (
  api: SnapshotFirstEditApi,
  iterations: number = 2,
): void => {
  const { bytes, manifest, depths } = buildWarmUpSnapshot(api);
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const kind of [
      { type: "local" },
      { type: "remote" },
      { type: "native" },
      ...depths.flatMap((depth) => [
        { type: "concurrent", depth } as const,
        { type: "native-concurrent", depth } as const,
      ]),
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
  if (isPreparedSnapshotEditKind(kind)) {
    throw new Error(
      `${formatSnapshotEditKind(kind)} prepares before its first edit; use measurePreparedSnapshotFirstEdit`,
    );
  }
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
  if (kind.type === "native-concurrent") {
    return measureNativeConcurrentEdit(
      api,
      snapshot,
      manifest,
      kind,
      decodeMs,
      collectGarbage,
    );
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
    prepareMs: 0,
    prepareSlices: 0,
    prepareLongestSliceMs: 0,
    readyToEditMs: decodeMs + restoreMs + firstEditMs,
    firstEditMs,
    secondEditMs,
    nativeDecodeMs: 0,
    nativeLoadMs: 0,
    nativeMaterializeMs: 0,
    finalTextLength: text.length,
    finalTextSha256: sha256Hex(text),
    finalTextValidated: true,
    statsAfterOpen: null,
    statsAfterFirstEdit,
    statsAfterSecondEdit,
    heapAfterOpenBytes: null,
    heapAfterGcBytes,
  };
};

/**
 * Time decode, restore, `prepare()` and two edits of one kind, then validate
 * the text, for a lane that prepares before its first edit. `trusted` lanes
 * read the bytes with `decodeAuthenticated`, so they need `authentication`.
 * `bytes` is copied before decode, as in {@link measureSnapshotFirstEdit}.
 */
export const measurePreparedSnapshotFirstEdit = async (
  api: SnapshotFirstEditApi,
  bytes: Uint8Array,
  manifest: SnapshotFirstEditManifest,
  kind: PreparedSnapshotEditKind,
  authentication: SnapshotAuthentication | null,
  collectGarbage: () => void = () => undefined,
): Promise<SnapshotFirstEditResult> => {
  const codec = new api.PortableSnapshotCodec();
  const persisted = bytes.slice();
  if (kind.open === "trusted" && authentication === null) {
    throw new Error(`${manifest.label}: the trusted lanes need a tag`);
  }

  collectGarbage();
  let startedAt = performance.now();
  const snapshot =
    kind.open === "trusted"
      ? await codec.decodeAuthenticated(
          persisted,
          authentication!.tag,
          authentication!.key,
        )
      : codec.decode(persisted);
  const decodeMs = performance.now() - startedAt;
  assertSnapshotMatchesManifest(snapshot, manifest);

  collectGarbage();
  startedAt = performance.now();
  const replica = api.EgWalkerReplica.fromPortableSnapshot(
    snapshot,
    "bench-local",
  );
  const restoreMs = performance.now() - startedAt;

  // Each slice runs from a resume, or the call, to the next yield.
  let sliceStartedAt = 0;
  let prepareSlices = 0;
  let prepareLongestSliceMs = 0;
  const endSlice = (): void => {
    prepareSlices++;
    prepareLongestSliceMs = Math.max(
      prepareLongestSliceMs,
      performance.now() - sliceStartedAt,
    );
  };
  const yieldToHost = (): Promise<void> => {
    endSlice();
    return new Promise((resolve) => {
      setImmediate(() => {
        sliceStartedAt = performance.now();
        resolve();
      });
    });
  };
  startedAt = performance.now();
  sliceStartedAt = startedAt;
  await replica.prepare(
    kind.open === "prepared-whole"
      ? { sliceMs: Number.POSITIVE_INFINITY, yieldToHost }
      : { yieldToHost },
  );
  endSlice();
  const prepareMs = performance.now() - startedAt;
  if (!replica.isPrepared()) {
    throw new Error(`${manifest.label}: prepare() did not prepare the replica`);
  }

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
    prepareMs,
    prepareSlices,
    prepareLongestSliceMs,
    readyToEditMs: decodeMs + restoreMs + prepareMs,
    firstEditMs,
    secondEditMs,
    nativeDecodeMs: 0,
    nativeLoadMs: 0,
    nativeMaterializeMs: 0,
    finalTextLength: text.length,
    finalTextSha256: sha256Hex(text),
    finalTextValidated: true,
    statsAfterOpen: null,
    statsAfterFirstEdit,
    statsAfterSecondEdit,
    heapAfterOpenBytes: null,
    heapAfterGcBytes,
  };
};

/**
 * {@link warmUpSnapshotFirstEdit} for the lanes that prepare. Run it only in
 * a process that measures one of them, so a lazy lane's warm-up stays the
 * same in every build.
 */
export const warmUpPreparedSnapshotFirstEdit = async (
  api: SnapshotFirstEditApi,
  iterations: number = 2,
): Promise<void> => {
  const { bytes, manifest, depths } = buildWarmUpSnapshot(api);
  const key = await importBenchAuthenticationKey();
  const authentication = {
    tag: await new api.PortableSnapshotCodec().authenticate(bytes, key),
    key,
  };
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const open of OPEN_MODES) {
      for (const kind of [
        { type: "local", open },
        { type: "remote", open },
        ...depths.map(
          (depth) => ({ type: "concurrent", depth, open }) as const,
        ),
      ] as const) {
        await measurePreparedSnapshotFirstEdit(
          api,
          bytes,
          manifest,
          kind,
          authentication,
        );
      }
    }
  }
};

type Edit = (replica: InstanceType<EgWalkerModule["EgWalkerReplica"]>) => void;

const PEER_ID = "bench-peer";

const buildEdits = (
  kind: Extract<
    SnapshotEditKind,
    { readonly type: "local" | "remote" | "concurrent" }
  >,
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

interface NativeColdLoad {
  readonly replica: InstanceType<EgWalkerModule["EgWalkerReplica"]>;
  readonly nativeDecodeMs: number;
  readonly nativeLoadMs: number;
  readonly nativeMaterializeMs: number;
  readonly heapAfterLoadBytes: number;
}

/** Decode the snapshot's graph and replay it into a fresh replica. */
const loadNativeGraph = (
  api: SnapshotFirstEditApi,
  snapshot: PortableSnapshot,
  manifest: SnapshotFirstEditManifest,
  collectGarbage: () => void,
): NativeColdLoad => {
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
  const heapAfterLoadBytes = process.memoryUsage().heapUsed;
  return {
    replica,
    nativeDecodeMs,
    nativeLoadMs,
    nativeMaterializeMs,
    heapAfterLoadBytes,
  };
};

const measureNativeLoad = (
  api: SnapshotFirstEditApi,
  snapshot: PortableSnapshot,
  manifest: SnapshotFirstEditManifest,
  decodeMs: number,
  collectGarbage: () => void,
): SnapshotFirstEditResult => {
  const loaded = loadNativeGraph(api, snapshot, manifest, collectGarbage);
  const stats = pickReplayStats(loaded.replica.getReplayStats());

  return {
    kind: "native",
    decodeMs,
    restoreMs: 0,
    prepareMs: 0,
    prepareSlices: 0,
    prepareLongestSliceMs: 0,
    readyToEditMs: decodeMs + loaded.nativeDecodeMs + loaded.nativeLoadMs,
    firstEditMs: 0,
    secondEditMs: 0,
    nativeDecodeMs: loaded.nativeDecodeMs,
    nativeLoadMs: loaded.nativeLoadMs,
    nativeMaterializeMs: loaded.nativeMaterializeMs,
    finalTextLength: manifest.textLength,
    finalTextSha256: manifest.textSha256,
    finalTextValidated: true,
    statsAfterOpen: stats,
    statsAfterFirstEdit: stats,
    statsAfterSecondEdit: null,
    heapAfterOpenBytes: loaded.heapAfterLoadBytes,
    heapAfterGcBytes: loaded.heapAfterLoadBytes,
  };
};

/**
 * Cold-load the decoded graph, then time the `concurrent` lane's two inserts.
 * Only the edits are timed as edits: the load is reported as `nativeLoadMs`.
 */
const measureNativeConcurrentEdit = (
  api: SnapshotFirstEditApi,
  snapshot: PortableSnapshot,
  manifest: SnapshotFirstEditManifest,
  kind: Extract<SnapshotEditKind, { readonly type: "native-concurrent" }>,
  decodeMs: number,
  collectGarbage: () => void,
): SnapshotFirstEditResult => {
  const loaded = loadNativeGraph(api, snapshot, manifest, collectGarbage);
  const { replica } = loaded;
  const statsAfterOpen = pickReplayStats(replica.getReplayStats());

  const [first, second] = buildEdits(
    { type: "concurrent", depth: kind.depth },
    manifest,
  );
  let startedAt = performance.now();
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
    restoreMs: 0,
    prepareMs: 0,
    prepareSlices: 0,
    prepareLongestSliceMs: 0,
    readyToEditMs: decodeMs + loaded.nativeDecodeMs + loaded.nativeLoadMs,
    firstEditMs,
    secondEditMs,
    nativeDecodeMs: loaded.nativeDecodeMs,
    nativeLoadMs: loaded.nativeLoadMs,
    nativeMaterializeMs: loaded.nativeMaterializeMs,
    finalTextLength: text.length,
    finalTextSha256: sha256Hex(text),
    finalTextValidated: true,
    statsAfterOpen,
    statsAfterFirstEdit,
    statsAfterSecondEdit,
    heapAfterOpenBytes: loaded.heapAfterLoadBytes,
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
  checkpointUniqueTextBytes: stats.checkpointUniqueTextBytes,
  criticalCheckpointHits: stats.criticalCheckpointHits,
  criticalCheckpointMisses: stats.criticalCheckpointMisses,
  lastReplaySource: stats.lastReplaySource,
  replayedEvents: stats.replayedEvents,
  fullReplayEvents: stats.fullReplayEvents,
  partialReplayEvents: stats.partialReplayEvents,
  lifetimeRetreats: stats.lifetimeRetreats,
  lifetimeAdvances: stats.lifetimeAdvances,
  replayCacheEvictions: stats.replayCacheEvictions,
  replayCacheBudgetRefusals: stats.replayCacheBudgetRefusals,
  replayCacheBudgetBytes: stats.replayCacheBudgetBytes,
  replayCacheEvents: stats.replayCacheEvents,
  sequenceRecordCount: stats.sequenceRecordCount,
});
