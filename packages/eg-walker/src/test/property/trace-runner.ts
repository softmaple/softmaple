/**
 * Trace runner for the property-test suite.
 *
 * Takes the plain-data {@link TraceParams} produced by `traceParamsArb`,
 * drives a fleet of {@link EgWalkerReplica} instances through the
 * scripts with periodic broadcasts, and returns the deduplicated event
 * list plus the canonical replay text for that event set.
 *
 * The runner deliberately does not call into `fast-check` itself — it
 * operates on plain inputs so a failing property can be reproduced by
 * calling it directly with the shrunk inputs.
 */

import { EgWalkerReplica } from "../../core/replica";
import { EventGraph } from "../../graph/event-graph";
import type { EventId, GraphEvent } from "../../types";
import { cloneEvent } from "../test-helpers";
import type { EditInstruction, TraceParams } from "./arbitraries";

export interface TraceResult {
  readonly events: ReadonlyArray<GraphEvent>;
  readonly canonicalText: string;
  readonly finalTextPerReplica: ReadonlyMap<string, string>;
}

const snapPastSurrogate = (text: string, index: number): number => {
  if (index <= 0 || index >= text.length) {
    return Math.max(0, Math.min(index, text.length));
  }
  const high = text.charCodeAt(index - 1);
  if (high < 0xd800 || high > 0xdbff) {
    return index;
  }
  const low = text.charCodeAt(index);
  if (low >= 0xdc00 && low <= 0xdfff) {
    return Math.min(index + 1, text.length);
  }
  return index;
};

const applyEdit = (replica: EgWalkerReplica, edit: EditInstruction): void => {
  const text = replica.getText();
  if (edit.kind === "insert") {
    if (edit.text.length === 0) {
      return;
    }
    const rawIndex = Math.floor(edit.offsetSeed * (text.length + 1));
    const index = snapPastSurrogate(text, rawIndex);
    replica.insert(index, edit.text);
    return;
  }
  if (text.length === 0) {
    return;
  }
  const rawStart = Math.floor(edit.offsetSeed * text.length);
  const start = snapPastSurrogate(text, Math.min(rawStart, text.length - 1));
  if (start >= text.length) {
    return;
  }
  const remaining = text.length - start;
  const rawLen = Math.max(1, Math.floor(edit.lengthSeed * remaining));
  const rawEnd = snapPastSurrogate(text, start + rawLen);
  const length = Math.min(rawEnd - start, remaining);
  if (length <= 0) {
    return;
  }
  replica.delete(start, length);
};

const broadcast = (params: {
  readonly replicas: ReadonlyArray<{
    readonly id: string;
    readonly replica: EgWalkerReplica;
  }>;
  readonly seenIds: Set<EventId>;
  readonly aggregateEvents: GraphEvent[];
}): void => {
  const { replicas, seenIds, aggregateEvents } = params;
  const fresh: GraphEvent[] = [];
  for (const { replica } of replicas) {
    for (const event of replica.exportEventGraph()) {
      if (seenIds.has(event.id)) {
        continue;
      }
      seenIds.add(event.id);
      aggregateEvents.push(cloneEvent(event));
      fresh.push(cloneEvent(event));
    }
  }
  if (fresh.length === 0) {
    return;
  }
  for (const { id, replica } of replicas) {
    const prefix = `${id}:`;
    for (const event of fresh) {
      if (event.id.startsWith(prefix)) {
        continue;
      }
      replica.applyRemoteEvent(cloneEvent(event));
    }
  }
};

export const canonicalReplay = (
  events: ReadonlyArray<GraphEvent>,
  initialText: string = "",
): string => {
  const graph = new EventGraph();
  for (const event of events.map(cloneEvent)) {
    graph.addEvent(event);
  }
  const replica = new EgWalkerReplica("canonical", initialText);
  for (const event of graph.getTopologicalOrder()) {
    replica.applyRemoteEvent(cloneEvent(event));
  }
  return replica.getText();
};

export const runTrace = (params: TraceParams): TraceResult => {
  const { initialText, scripts, syncEveryN } = params;
  const sims = scripts.map(({ replicaId }) => ({
    id: replicaId,
    replica: new EgWalkerReplica(replicaId, initialText),
  }));

  const seenIds = new Set<EventId>();
  const aggregateEvents: GraphEvent[] = [];
  const sync = (): void =>
    broadcast({ replicas: sims, seenIds, aggregateEvents });

  // Interleave the per-replica scripts step-by-step so concurrent
  // edits actually overlap rather than each replica completing all
  // its edits before the next gets a turn.
  const maxSteps = scripts.reduce(
    (max, { edits }) => Math.max(max, edits.length),
    0,
  );
  let stepCounter = 0;
  for (let step = 0; step < maxSteps; step++) {
    for (let r = 0; r < sims.length; r++) {
      const edits = scripts[r]!.edits;
      if (step >= edits.length) {
        continue;
      }
      applyEdit(sims[r]!.replica, edits[step]!);
      stepCounter++;
      if (stepCounter % syncEveryN === 0) {
        sync();
      }
    }
  }
  sync();

  const finalTextPerReplica = new Map<string, string>();
  for (const { id, replica } of sims) {
    finalTextPerReplica.set(id, replica.getText());
  }
  const canonicalText = canonicalReplay(aggregateEvents, initialText);
  return {
    events: aggregateEvents,
    canonicalText,
    finalTextPerReplica,
  };
};
