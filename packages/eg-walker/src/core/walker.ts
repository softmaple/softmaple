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
}

/**
 * High-level event graph walker.
 *
 * This is intentionally thin: graph ordering and causal diffs live in
 * EventGraph, while prepare/effect replay lives in EgWalkerEngine.
 */
export class EgWalker {
  private prepareVersion: Version = new Set();
  private effectVersion: Version = new Set();

  constructor(private readonly config: WalkerConfig = {}) {}

  walk(events: ReadonlyArray<GraphEvent>): WalkResult {
    const graph = new EventGraph();
    for (const event of events) {
      graph.addEvent(event);
    }

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
    };
  }

  getPrepareVersion(): Version {
    return new Set(this.prepareVersion);
  }

  getEffectVersion(): Version {
    return new Set(this.effectVersion);
  }
}
