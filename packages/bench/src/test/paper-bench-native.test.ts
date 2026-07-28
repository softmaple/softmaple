import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildNativePaperPayload,
  measureNativePaperPayload,
} from "../bench/paper-bench-native";
import { OPERATION_TYPE, type GraphEvent } from "@softmaple/eg-walker";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testDirectory, "../..");

describe("native-only paper benchmark", () => {
  it("decodes, loads, materializes, and validates an EGW3 payload", () => {
    const events: GraphEvent[] = [
      {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 0,
      },
      {
        id: "alice:1",
        parentVersion: new Set(["alice:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "🙂" },
        timestamp: 1,
      },
      {
        id: "alice:2",
        parentVersion: new Set(["alice:1"]),
        operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
        timestamp: 2,
      },
    ];

    const payload = buildNativePaperPayload(events, "🙂");
    let garbageCollections = 0;
    const result = measureNativePaperPayload(
      payload,
      "native-only-test",
      () => {
        garbageCollections++;
      },
    );

    expect(garbageCollections).toBe(3);
    expect(result.binaryBytes).toBeGreaterThan(0);
    expect(result.eventCount).toBe(3);
    expect(result.frontierSize).toBe(1);
    expect(result.finalTextLength).toBe(2);
    expect(result.finalTextValidated).toBe(true);
    expect(result.nativeDecodeMs).toBeGreaterThanOrEqual(0);
    expect(result.nativeLoadMs).toBeGreaterThanOrEqual(0);
    expect(result.nativeMaterializeMs).toBeGreaterThanOrEqual(0);
    expect(result.heapBeforeDecodeBytes).toBeGreaterThan(0);
    expect(result.arrayBuffersBeforeDecodeBytes).toBeGreaterThanOrEqual(0);
    expect(result.rssBeforeDecodeBytes).toBeGreaterThan(0);
    expect(result.heapAfterDecodeBytes).toBeGreaterThan(0);
    expect(result.arrayBuffersAfterDecodeBytes).toBeGreaterThanOrEqual(0);
    expect(result.rssAfterDecodeBytes).toBeGreaterThan(0);
    expect(result.heapAfterLoadBytes).toBeGreaterThan(0);
    expect(result.arrayBuffersAfterLoadBytes).toBeGreaterThanOrEqual(0);
    expect(result.rssAfterLoadBytes).toBeGreaterThan(0);
    expect(result.nativeDecodeHeapBytes).toBe(
      result.heapAfterDecodeBytes - result.heapBeforeDecodeBytes,
    );
    expect(result.nativeLoadHeapBytes).toBe(
      result.heapAfterLoadBytes - result.heapAfterDecodeBytes,
    );
    expect(result.nativeTotalHeapBytes).toBe(
      result.heapAfterLoadBytes - result.heapBeforeDecodeBytes,
    );
    expect(result.nativeDecodeArrayBufferBytes).toBe(
      result.arrayBuffersAfterDecodeBytes -
        result.arrayBuffersBeforeDecodeBytes,
    );
    expect(result.nativeLoadArrayBufferBytes).toBe(
      result.arrayBuffersAfterLoadBytes - result.arrayBuffersAfterDecodeBytes,
    );
    expect(result.nativeTotalArrayBufferBytes).toBe(
      result.arrayBuffersAfterLoadBytes - result.arrayBuffersBeforeDecodeBytes,
    );
    expect(result.replayStats.fullReplays).toBe(1);
  });

  it("runs the native-only CLI lane against a small paper fixture", () => {
    const result = spawnSync(
      process.execPath,
      [
        resolve(packageRoot, "scripts/run-paper-bench.mjs"),
        "--native-only",
        "--datasets",
        "S1",
        "--runs",
        "1",
        "--paper-root",
        resolve(testDirectory, "fixtures/paper-bench"),
      ],
      { cwd: packageRoot, encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("paper-bench-native dataset=S1");
    expect(result.stdout).toContain("events=3");
    expect(result.stdout).toContain("finalTextValidated=true");
    expect(result.stdout).toMatch(/nativeDecodeHeapBytes=-?\d+/);
    expect(result.stdout).toMatch(/nativeLoadHeapBytes=-?\d+/);
    expect(result.stdout).toMatch(/nativeTotalHeapBytes=-?\d+/);
    expect(result.stdout).toMatch(/nativeDecodeArrayBufferBytes=-?\d+/);
    expect(result.stdout).toMatch(/nativeLoadArrayBufferBytes=-?\d+/);
    expect(result.stdout).toMatch(/nativeTotalArrayBufferBytes=-?\d+/);
    expect(result.stdout).toMatch(/rssAfterLoadBytes=\d+/);
    expect(result.stdout).toContain("paper-bench-native-summary dataset=S1");
  });
});
