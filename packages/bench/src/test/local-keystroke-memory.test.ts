import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "@softmaple/eg-walker";
import {
  measureLocalKeystrokeMemory,
  parseLocalKeystrokeMode,
} from "../bench/local-keystroke-memory";

const fakeMemory = (
  samples: ReadonlyArray<{ heapUsed: number; arrayBuffers: number }>,
) => {
  let index = 0;
  return () => {
    const sample = samples[index++];
    if (sample === undefined) {
      throw new Error("unexpected memory sample");
    }
    return sample;
  };
};

describe("local keystroke memory", () => {
  it("reports retained heap and array buffers per keystroke", () => {
    let collections = 0;
    const result = measureLocalKeystrokeMemory(
      { EgWalkerReplica },
      {
        count: 100,
        mode: "middle",
        collectGarbage: () => {
          collections++;
        },
        memoryUsage: fakeMemory([
          { heapUsed: 1_000, arrayBuffers: 500 },
          { heapUsed: 3_000, arrayBuffers: 1_500 },
        ]),
      },
    );

    expect(collections).toBe(4);
    expect(result).toMatchObject({
      count: 100,
      mode: "middle",
      heapBytes: 2_000,
      arrayBufferBytes: 1_000,
      heapBytesPerKeystroke: 20,
      arrayBufferBytesPerKeystroke: 10,
      retainedBytesPerKeystroke: 30,
    });
    expect(result.typeMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects invalid counts and modes", () => {
    expect(() =>
      measureLocalKeystrokeMemory(
        { EgWalkerReplica },
        { count: 0, mode: "append", collectGarbage: () => undefined },
      ),
    ).toThrow("positive integer");
    expect(parseLocalKeystrokeMode("append")).toBe("append");
    expect(() => parseLocalKeystrokeMode("random")).toThrow(
      "keystroke mode must be one of append, middle",
    );
  });
});
