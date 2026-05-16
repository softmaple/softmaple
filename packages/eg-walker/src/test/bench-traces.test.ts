import { describe, expect, it } from "vitest";

import {
  buildCheckpointTrace,
  buildConcurrentSameIndexInserts,
  buildDeleteHeavyWorkload,
  buildLongLinearHistory,
  buildLongOfflineBranchMerge,
} from "../bench/traces";

describe("bench trace builders", () => {
  it("buildLongLinearHistory returns the requested event count", () => {
    expect(buildLongLinearHistory(10)).toHaveLength(10);
  });

  it("buildConcurrentSameIndexInserts emits root-concurrent inserts", () => {
    const events = buildConcurrentSameIndexInserts(3);
    expect(events).toHaveLength(3);
    expect([...events[0].parentVersion]).toHaveLength(0);
    expect(events[1].operation.type).toBe("insert");
  });

  it("buildLongOfflineBranchMerge includes root and merge around both branches", () => {
    const events = buildLongOfflineBranchMerge(0);
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe("root:0");
    expect(events[1].id).toBe("merge:0");
  });

  it("buildDeleteHeavyWorkload remains causally linear", () => {
    const events = buildDeleteHeavyWorkload(20);
    expect(events).toHaveLength(20);
    expect(
      events.every(
        (event, index) => index === 0 || event.parentVersion.size === 1,
      ),
    ).toBe(true);
  });

  it("buildCheckpointTrace emits deterministic non-empty traces", () => {
    const events = buildCheckpointTrace({
      mainEvents: 10,
      forkEveryN: 5,
      forkDepth: 2,
    });
    expect(events.length).toBeGreaterThan(10);
    expect(events[0]?.id).toBe("main:0");
  });
});
