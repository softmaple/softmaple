import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { EventGraph } from "../graph/event-graph";
import type { GraphEvent, Version } from "../types";

export interface WalkerConfig {
  readonly initialText?: string;
}

export interface WalkResult {
  readonly finalText: string;
  readonly eventsProcessed: number;
  readonly retreatCount: number;
  readonly advanceCount: number;
  /**
   * Section 3.4 internal-document fast path: events whose parent version
   * already matched the engine's current version and skipped the
   * diff/retreat/advance machinery entirely. Useful for verifying that
   * mostly linear traces hit the fast path.
   */
  readonly nonConflictingRunCount: number;
  /**
   * Counterpart to {@link nonConflictingRunCount}: events that fell through
   * to the full prepare/effect replay path.
   */
  readonly fullReplayCount: number;
}

/**
 * One-shot event-graph replay coordinator.
 *
 * Intentionally thin: graph ordering and causal diffs live in EventGraph,
 * prepare/effect replay lives in EgWalkerEngine, and the stateful editing
 * surface lives in EgWalkerReplica. Use this for batch "given these events,
 * what's the resulting text" computations.
 */
export class ReplayWalker {
  private prepareVersion: Version = new Set();
  private effectVersion: Version = new Set();

  constructor(private readonly config: WalkerConfig = {}) {}

  walk(events: ReadonlyArray<GraphEvent>): WalkResult {
    const graph = EventGraph.fromEvents(events);

    const orderedEvents = graph.getTopologicalOrder();
    const generated = new EgWalkerEngine().generate(
      orderedEvents,
      this.config.initialText ?? "",
      { eventGraph: graph },
    );

    this.prepareVersion = graph.getFrontier();
    this.effectVersion = graph.getFrontier();

    return {
      finalText: generated.text,
      eventsProcessed: generated.stats.eventsProcessed,
      retreatCount: generated.stats.retreatCount,
      advanceCount: generated.stats.advanceCount,
      nonConflictingRunCount: generated.stats.nonConflictingRunCount,
      fullReplayCount: generated.stats.fullReplayCount,
    };
  }

  getPrepareVersion(): Version {
    return new Set(this.prepareVersion);
  }

  getEffectVersion(): Version {
    return new Set(this.effectVersion);
  }
}
