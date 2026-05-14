import { describe, expect, it } from "vitest";
import { EgWalkerReplica } from "../core/replica";
import { cloneEvent } from "./test-helpers";
import type { GraphEvent } from "../types";

const syncFrom = (
  from: EgWalkerReplica,
  to: EgWalkerReplica,
  seen: Set<string>,
): void => {
  for (const event of from.exportEventGraph()) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    to.applyRemoteEvent(cloneEvent(event));
  }
};

describe("seed placeholder split keeps delete targets in sync", () => {
  // Regression test for the case the #689 review flagged. When the
  // initial-document seed is collapsed into a single placeholder record
  // (Section 3.4 / commit-E), a delete of a multi-code-unit seed range
  // only records the placeholder id in `deleteTargets`. A later
  // concurrent insert that lands inside that range used to split the
  // placeholder without extending the delete's target list, so
  // retreat/advance only adjusted the prepare-state of the left half
  // and a subsequent local insert at the document end landed in the
  // middle of the deleted range.
  it("abcd / concurrent delete(1,2) + insert(2,X) / then insert(3,Y) lands at the end", () => {
    const seed = "abcd";
    const r1 = new EgWalkerReplica("r1", seed);
    const r2 = new EgWalkerReplica("r2", seed);
    const r3 = new EgWalkerReplica("r3", seed);

    const seen1 = new Set<string>();
    const seen2 = new Set<string>();
    const seen3 = new Set<string>();

    r1.delete(1, 2);
    expect(r1.getText()).toBe("ad");

    r2.insert(2, "X");
    expect(r2.getText()).toBe("abXcd");

    syncFrom(r1, r3, seen3);
    syncFrom(r2, r3, seen3);
    // After both: from "abcd", delete "bc" + insert "X" between b and c.
    // Expected: "aXd".
    expect(r3.getText()).toBe("aXd");

    r3.insert(3, "Y"); // append Y at end of "aXd"
    expect(r3.getText()).toBe("aXdY");

    syncFrom(r3, r1, seen1);
    syncFrom(r2, r1, seen1);
    syncFrom(r3, r2, seen2);
    syncFrom(r1, r2, seen2);

    expect(r1.getText()).toBe("aXdY");
    expect(r2.getText()).toBe("aXdY");
  });

  it("every legal delivery order of the regression graph converges to aXdY", () => {
    // Build the graph from one driver, then apply to fresh replicas
    // under every meaningful delivery order.
    const seed = "abcd";
    const driver = new EgWalkerReplica("driver", seed);
    // Force two distinct authors to keep the graph diverse.
    const r1 = new EgWalkerReplica("r1", seed);
    const r2 = new EgWalkerReplica("r2", seed);
    r1.delete(1, 2);
    r2.insert(2, "X");
    const seenD = new Set<string>();
    syncFrom(r1, driver, seenD);
    syncFrom(r2, driver, seenD);
    driver.insert(3, "Y");
    expect(driver.getText()).toBe("aXdY");

    const allEvents: GraphEvent[] = driver.exportEventGraph().map(cloneEvent);
    const permute = (arr: GraphEvent[]): GraphEvent[][] => {
      if (arr.length <= 1) return [arr];
      const out: GraphEvent[][] = [];
      for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        for (const p of permute(rest)) out.push([arr[i]!, ...p]);
      }
      return out;
    };
    const orderings = permute(allEvents);
    let convergedCount = 0;
    let divergent: { order: string[]; text: string } | null = null;
    for (const order of orderings) {
      const fresh = new EgWalkerReplica("fresh", seed);
      try {
        for (const ev of order) fresh.applyRemoteEvent(cloneEvent(ev));
      } catch {
        continue; // illegal order (parent before child); skip
      }
      if (fresh.getText() === "aXdY") convergedCount++;
      else if (!divergent) {
        divergent = {
          order: order.map((e) => e.id),
          text: fresh.getText(),
        };
      }
    }
    expect(
      divergent,
      divergent
        ? `divergent order ${JSON.stringify(divergent.order)} -> ${divergent.text}`
        : "ok",
    ).toBeNull();
    expect(convergedCount).toBeGreaterThan(0);
  });
});
