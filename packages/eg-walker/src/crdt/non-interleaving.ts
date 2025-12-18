/**
 * Non-interleaving invariants for Section 3.1
 *
 * Ensures concurrent insertions are grouped into runs,
 * not interleaved character-by-character
 */

import type { CRDTItem, EventId, OrderingRule } from "../types";

/**
 * Represents a run of characters from the same insertion
 */
export interface InsertionRun {
  readonly eventId: EventId;
  readonly content: string;
  readonly startIndex: number;
  readonly originLeft: EventId | null;
  readonly originRight: EventId | null;
}

/**
 * Group CRDT items into runs based on their creating event
 * This enforces the non-interleaving property
 */
export function groupIntoRuns(
  items: ReadonlyArray<CRDTItem>,
): ReadonlyArray<InsertionRun> {
  if (items.length === 0) return [];

  const runs: InsertionRun[] = [];
  let currentRun: InsertionRun | null = null;
  let currentIndex = 0;

  for (const item of items) {
    if (item.isDeleted) {
      currentIndex++;
      continue;
    }

    if (currentRun && currentRun.eventId === item.insertedBy) {
      // Extend current run
      currentRun = {
        eventId: currentRun.eventId,
        content: currentRun.content + item.content,
        startIndex: currentRun.startIndex,
        originLeft: currentRun.originLeft,
        originRight: currentRun.originRight,
      };
    } else {
      // Start new run
      if (currentRun) {
        runs.push(currentRun);
      }
      currentRun = {
        eventId: item.insertedBy,
        content: item.content,
        startIndex: currentIndex,
        originLeft: item.originLeft,
        originRight: item.originRight,
      };
    }

    currentIndex++;
  }

  if (currentRun) {
    runs.push(currentRun);
  }

  return runs;
}

/**
 * Non-interleaving ordering rule
 * Ensures runs from the same event stay together
 */
export class NonInterleavingOrder implements OrderingRule {
  constructor(
    private readonly tieBreaker:
      | "timestamp"
      | "replica-id"
      | "lexicographic" = "replica-id",
  ) {}

  /**
   * Compare two CRDT items to determine order
   * Items from the same event should stay together
   */
  compare(a: CRDTItem, b: CRDTItem): boolean {
    // If from same event, maintain their relative order
    if (a.insertedBy === b.insertedBy) {
      // Use content position as tiebreaker within same event
      return a.id < b.id; // Assumes IDs encode position
    }

    // If concurrent at same position, use tiebreaker
    if (a.originLeft === b.originLeft) {
      return this.breakTie(a, b);
    }

    // Otherwise use RGA rules (handled elsewhere)
    return false;
  }

  private breakTie(a: CRDTItem, b: CRDTItem): boolean {
    switch (this.tieBreaker) {
      case "replica-id": {
        const [replicaA] = a.insertedBy.split(":");
        const [replicaB] = b.insertedBy.split(":");
        return (replicaA ?? "") < (replicaB ?? "");
      }

      case "lexicographic":
        return a.insertedBy < b.insertedBy;

      case "timestamp":
        // Would need timestamp info on items
        return a.id < b.id;

      default:
        return a.id < b.id;
    }
  }
}

/**
 * Verify that a sequence of items satisfies non-interleaving
 */
export function verifyNonInterleaving(items: ReadonlyArray<CRDTItem>): boolean {
  const runs = groupIntoRuns(items);
  const eventRuns = new Map<EventId, InsertionRun[]>();

  // Group runs by event
  for (const run of runs) {
    const existing = eventRuns.get(run.eventId) || [];
    existing.push(run);
    eventRuns.set(run.eventId, existing);
  }

  // Check that each event has at most one run
  // (multiple runs would indicate interleaving)
  for (const [, eventRunList] of eventRuns) {
    if (eventRunList.length > 1) {
      // Event was split into multiple runs - interleaving detected!
      return false;
    }
  }

  return true;
}

/**
 * Alias for verifyNonInterleaving (for backward compatibility)
 */
export const ensureNonInterleaving = verifyNonInterleaving;

/**
 * Block order strategies for non-interleaving
 */
export const BLOCK_ORDER_STRATEGIES = {
  TIMESTAMP: "timestamp" as const,
  REPLICA_ID: "replica-id" as const,
  LEXICOGRAPHIC: "lexicographic" as const,
};

/**
 * Merge concurrent runs while preserving non-interleaving
 */
export function mergeRuns(
  run1: InsertionRun,
  run2: InsertionRun,
  order: OrderingRule,
): ReadonlyArray<InsertionRun> {
  // Create dummy items to use ordering rule
  const item1: CRDTItem = {
    id: run1.eventId,
    content: run1.content,
    originLeft: run1.originLeft,
    originRight: run1.originRight,
    isDeleted: false,
    insertedBy: run1.eventId,
  };

  const item2: CRDTItem = {
    id: run2.eventId,
    content: run2.content,
    originLeft: run2.originLeft,
    originRight: run2.originRight,
    isDeleted: false,
    insertedBy: run2.eventId,
  };

  // Use ordering rule to determine which run comes first
  if (order.compare(item1, item2)) {
    return [run1, run2];
  } else {
    return [run2, run1];
  }
}
