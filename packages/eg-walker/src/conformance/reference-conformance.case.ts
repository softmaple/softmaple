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

// Helpers

const loadPinnedReferenceRuns = (): ReadonlyArray<ReferenceRun> => {
  if (!existsSync(conformancePath)) {
    throw new Error(
      `Missing pinned eg-walker reference fixture at ${conformancePath}. ` +
        "Set EG_WALKER_REFERENCE_ROOT to the checkout root.",
    );
  }

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

  const bytes = readFileSync(conformancePath);
  const actualChecksum = createHash("sha256").update(bytes).digest("hex");
  if (actualChecksum !== CONFORMANCE_SHA256) {
    throw new Error(
      `Expected conformance checksum ${CONFORMANCE_SHA256}, received ${actualChecksum}`,
    );
  }

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
