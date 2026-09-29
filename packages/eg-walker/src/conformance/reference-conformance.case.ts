import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";

const REFERENCE_COMMIT = "4d9bef55e4f2e3b3b8b0efe8f91cd35d34ed35a8";
const CONFORMANCE_SHA256 =
  "95bdb544deca513441a50ea26a1c3ecbad116061c1d0fd6dde3175ea1e0bffd7";
const EXPECTED_RUN_COUNT = 1_000;
const EXPECTED_EVENT_COUNT = 91_678;

/**
 * Raw Diamond Types exports that keep real agent names. Unlike the paper's
 * numbered JSON datasets, DT's `endContent` is reachable from these, so they
 * pin concurrent-insert ordering to DT. git-makefile is the source of A2 and
 * node_nodecc the source of A1.
 */
const RAW_DT_EXPORTS = [
  {
    file: "ff-raw.json",
    sha256: "3ed8056ca141b7a513e4d3cc4790e5490869cb440753b0d3a4ddaf4ce18b26ee",
    eventCount: 26_078,
  },
  {
    file: "git-makefile-raw.json",
    sha256: "f4c5056f538d1e2a4490c6632558f26bd8d1c4147801bce2ffc2a9674f37a63d",
    eventCount: 348_819,
  },
  {
    file: "node_nodecc-raw.json",
    sha256: "0d556fdf974f9f5da7fd0336121029c5542220f830ad6e6ca2e93f64af6e3e1f",
    eventCount: 947_337,
  },
] as const;

interface ReferenceTransaction {
  readonly span: readonly [number, number];
  readonly parents: ReadonlyArray<number>;
  readonly agent: string;
  readonly seqStart: number;
  readonly ops: ReadonlyArray<
    readonly [position: number, deleteLength: number, insertedText: string]
  >;
}

interface ReferenceRun {
  readonly endContent: string;
  readonly txns: ReadonlyArray<ReferenceTransaction>;
}

type EventIdMode = "canonical" | "padded";

const referenceRoot =
  process.env.EG_WALKER_REFERENCE_ROOT ??
  join(homedir(), ".cache", "eg-walker-reference");
const conformancePath = join(referenceRoot, "testdata", "conformance.json");

describe("pinned eg-walker reference conformance", () => {
  it.each<EventIdMode>([
    "canonical",
    "padded",
  ])("should match every official run with %s IDs", (idMode) => {
    // Arrange
    const runs = loadPinnedReferenceRuns();
    const codec = new ColumnarEventGraphCodec();

    // Act
    let eventCount = 0;
    for (let runIndex = 0; runIndex < runs.length; runIndex++) {
      const run = runs[runIndex]!;
      const events = convertReferenceRun(run, idMode);
      eventCount += events.length;
      const graph = EventGraph.fromEvents(events);
      const actual = new EgWalkerEngine().generate(events, "", {
        eventGraph: graph,
        eventOrder: events,
      }).text;
      const packedGraph = codec.decodeBinary(codec.encodeBinary(graph));
      const packedActual = new EgWalkerReplica(
        `conformance-${idMode}`,
        "",
        packedGraph,
      ).getText();

      // Assert
      expect(actual, `reference run ${runIndex}`).toBe(run.endContent);
      expect(
        packedGraph.getPackedReplayPlanningView(),
        `packed reference run ${runIndex}`,
      ).not.toBeNull();
      expect(packedActual, `packed reference run ${runIndex}`).toBe(
        run.endContent,
      );
    }
    expect(runs).toHaveLength(EXPECTED_RUN_COUNT);
    expect(eventCount).toBe(EXPECTED_EVENT_COUNT);
  });
});

describe("pinned raw Diamond Types exports", () => {
  it.each(RAW_DT_EXPORTS)("should match DT endContent for $file", ({
    file,
    sha256,
    eventCount,
  }) => {
    // Arrange
    const run = loadPinnedRawExport(file, sha256);
    const events = convertReferenceRun(run, "canonical");
    const graph = EventGraph.fromEvents(events);
    const codec = new ColumnarEventGraphCodec();

    // Act
    const actual = new EgWalkerEngine().generate(events, "", {
      eventGraph: graph,
      eventOrder: events,
    }).text;
    const packedGraph = codec.decodeBinary(codec.encodeBinary(graph));
    const packedActual = new EgWalkerReplica(
      `raw-dt-${file}`,
      "",
      packedGraph,
    ).getText();

    // Assert
    expect(events).toHaveLength(eventCount);
    expect(actual === run.endContent, `${file} engine replay`).toBe(true);
    expect(
      packedGraph.getPackedReplayPlanningView(),
      `${file} packed graph`,
    ).not.toBeNull();
    expect(packedActual === run.endContent, `${file} packed replay`).toBe(true);
  }, 300_000);
});

// Helpers

const assertPinnedReferenceCommit = (): void => {
  const actualCommit = execFileSync(
    "git",
    ["-C", referenceRoot, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  if (actualCommit !== REFERENCE_COMMIT) {
    throw new Error(
      `Expected eg-walker-reference ${REFERENCE_COMMIT}, received ${actualCommit}`,
    );
  }
};

const readPinnedFixture = (path: string, expectedSha256: string): Buffer => {
  if (!existsSync(path)) {
    throw new Error(
      `Missing pinned eg-walker reference fixture at ${path}. ` +
        "Set EG_WALKER_REFERENCE_ROOT to the checkout root.",
    );
  }
  assertPinnedReferenceCommit();

  const bytes = readFileSync(path);
  const actualChecksum = createHash("sha256").update(bytes).digest("hex");
  if (actualChecksum !== expectedSha256) {
    throw new Error(
      `Expected ${path} checksum ${expectedSha256}, received ${actualChecksum}`,
    );
  }
  return bytes;
};

const loadPinnedRawExport = (file: string, sha256: string): ReferenceRun => {
  const bytes = readPinnedFixture(
    join(referenceRoot, "testdata", file),
    sha256,
  );
  return JSON.parse(bytes.toString("utf8")) as ReferenceRun;
};

const loadPinnedReferenceRuns = (): ReadonlyArray<ReferenceRun> => {
  const bytes = readPinnedFixture(conformancePath, CONFORMANCE_SHA256);

  const parsed: unknown = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Reference conformance fixture must contain an array");
  }
  return parsed as ReadonlyArray<ReferenceRun>;
};

const convertReferenceRun = (
  run: ReferenceRun,
  idMode: EventIdMode,
): GraphEvent[] => {
  const events: GraphEvent[] = [];
  const eventIdByLocalVersion = new Map<number, EventId>();

  for (const transaction of run.txns) {
    let sequence = transaction.seqStart;
    let localVersion = transaction.span[0];
    let parents = transaction.parents.map((parent) => {
      const parentId = eventIdByLocalVersion.get(parent);
      if (parentId === undefined) {
        throw new Error(`Unknown reference parent local version ${parent}`);
      }
      return parentId;
    });

    for (const [rawPosition, deleteLength, insertedText] of transaction.ops) {
      let position = rawPosition;
      for (let offset = 0; offset < deleteLength; offset++) {
        const id = referenceEventId(transaction.agent, sequence++, idMode);
        events.push({
          id,
          parentVersion: new Set(parents),
          operation: {
            type: OPERATION_TYPE.DELETE,
            index: position,
            length: 1,
          },
          timestamp: localVersion,
        });
        eventIdByLocalVersion.set(localVersion++, id);
        parents = [id];
      }

      for (const character of insertedText) {
        const id = referenceEventId(transaction.agent, sequence++, idMode);
        events.push({
          id,
          parentVersion: new Set(parents),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: position++,
            text: character,
          },
          timestamp: localVersion,
        });
        eventIdByLocalVersion.set(localVersion++, id);
        parents = [id];
      }
    }

    if (localVersion !== transaction.span[1]) {
      throw new Error(
        `Reference transaction span ${transaction.span.join("..")} ended at ${localVersion}`,
      );
    }
  }

  return events;
};

const referenceEventId = (
  agent: string,
  sequence: number,
  mode: EventIdMode,
): EventId =>
  mode === "canonical"
    ? `${agent}:${sequence}`
    : `${agent}#${sequence.toString().padStart(8, "0")}`;
