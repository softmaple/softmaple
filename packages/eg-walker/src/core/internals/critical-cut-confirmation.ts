import type { EventGraph } from "../../graph/event-graph";

/**
 * Events after a critical cut, all descending from it, that confirm the cut
 * even while some authors of the replay cache's interval have not built on
 * it, such as an author who has left the session.
 */
export const CRITICAL_CUT_CONFIRMATION_EVENTS = 1_024;

/**
 * Most authors a cut waits for. A cut whose interval has more authors is
 * confirmed by {@link CRITICAL_CUT_CONFIRMATION_EVENTS} alone.
 */
export const MAX_CONFIRMING_AUTHORS = 64;

type CriticalCutGraph = Pick<
  EventGraph,
  "agentAt" | "forEachParentLocalVersion"
>;

/** Authors of the events in a replay cache's interval, as agent numbers. */
export interface IntervalAuthors {
  /**
   * Canonical authors seen so far, or `null` once there are more than
   * {@link MAX_CONFIRMING_AUTHORS}.
   */
  readonly agents: ReadonlySet<number> | null;
  /** Local version the scan has reached: events before it are counted. */
  readonly scannedEventCount: number;
}

/**
 * A singleton frontier that the replay cache may be released at.
 *
 * A singleton frontier is critical among the events a replica holds: every
 * other event is its ancestor, so it is the event at local version
 * `eventCount - 1`. An author that has not seen it can still send an event
 * concurrent with it, though, and after a release no checkpoint after the cut
 * can serve that event. Under sustained concurrency every such cut is undone
 * this way, and each undone release costs a replay of the whole concurrent
 * interval.
 *
 * Each author's events form one causal chain and arrive in causal order. Once
 * an author has delivered an event that descends from the cut, none of its
 * later events can be concurrent with it, so the cut is confirmed when every
 * author of the cached interval has, or when
 * {@link CRITICAL_CUT_CONFIRMATION_EVENTS} events after it all descend from
 * it. An event that does not descend from the cut cancels it.
 *
 * Values are immutable, so a receive transaction can keep and restore them.
 */
export interface PendingCriticalCut {
  /** Events in the cut's closure; the cut is the last of them. */
  readonly eventCount: number;
  /** Events after the cut checked so far end before this local version. */
  readonly checkedEventCount: number;
  /**
   * Authors that have not yet delivered an event descending from the cut, or
   * `null` when the interval had too many authors to wait for.
   */
  readonly awaitingAgents: ReadonlySet<number> | null;
}

export const emptyIntervalAuthors = (
  startEventCount: number,
): IntervalAuthors => ({
  agents: new Set(),
  scannedEventCount: startEventCount,
});

/** `authors`, extended to count every event before `eventCount`. */
export const scanIntervalAuthors = (
  authors: IntervalAuthors,
  graph: CriticalCutGraph,
  eventCount: number,
): IntervalAuthors => {
  if (authors.scannedEventCount >= eventCount) {
    return authors;
  }
  if (authors.agents === null) {
    return { agents: null, scannedEventCount: eventCount };
  }
  let added: Set<number> | null = null;
  for (
    let localVersion = authors.scannedEventCount;
    localVersion < eventCount;
    localVersion++
  ) {
    const agent = graph.agentAt(localVersion);
    // An event with a custom ID names no author whose chain can be followed.
    if (agent < 0 || (added ?? authors.agents).has(agent)) {
      continue;
    }
    added ??= new Set(authors.agents);
    added.add(agent);
    if (added.size > MAX_CONFIRMING_AUTHORS) {
      return { agents: null, scannedEventCount: eventCount };
    }
  }
  return { agents: added ?? authors.agents, scannedEventCount: eventCount };
};

/**
 * The cut at the singleton frontier of a graph of `eventCount` events,
 * waiting for every author in `authors` except `settledAgents`: the cut's own
 * author and the local replica, whose later events descend from the cut.
 */
export const openCriticalCut = (
  eventCount: number,
  authors: IntervalAuthors,
  settledAgents: ReadonlyArray<number>,
): PendingCriticalCut => ({
  eventCount,
  checkedEventCount: eventCount,
  awaitingAgents:
    authors.agents === null
      ? null
      : new Set(
          [...authors.agents].filter((agent) => !settledAgents.includes(agent)),
        ),
});

/**
 * `cut` after checking the events before `eventCount`, or `null` when one of
 * them does not descend from it.
 *
 * Every event checked before descends from the cut, so a later event does
 * exactly when one of its parents is the cut or comes after it.
 */
export const advanceCriticalCut = (
  cut: PendingCriticalCut,
  graph: CriticalCutGraph,
  eventCount: number,
): PendingCriticalCut | null => {
  if (cut.checkedEventCount >= eventCount) {
    return cut;
  }
  const cutLocalVersion = cut.eventCount - 1;
  let awaiting: Set<number> | null = null;
  for (
    let localVersion = cut.checkedEventCount;
    localVersion < eventCount;
    localVersion++
  ) {
    if (latestParentOf(graph, localVersion) < cutLocalVersion) {
      return null;
    }
    const remaining: ReadonlySet<number> | null =
      awaiting ?? cut.awaitingAgents;
    if (remaining === null || remaining.size === 0) {
      continue;
    }
    const agent = graph.agentAt(localVersion);
    if (remaining.has(agent)) {
      awaiting ??= new Set(remaining);
      awaiting.delete(agent);
    }
  }
  return {
    eventCount: cut.eventCount,
    checkedEventCount: eventCount,
    awaitingAgents: awaiting ?? cut.awaitingAgents,
  };
};

/** The latest parent of the event at `localVersion`, or -1 for a root. */
const latestParentOf = (
  graph: CriticalCutGraph,
  localVersion: number,
): number => {
  let latest = -1;
  graph.forEachParentLocalVersion(localVersion, (parent) => {
    latest = Math.max(latest, parent);
  });
  return latest;
};

/** Whether no author of the cut's interval can still undo it. */
export const isCriticalCutConfirmed = (cut: PendingCriticalCut): boolean =>
  cut.awaitingAgents?.size === 0 ||
  cut.checkedEventCount - cut.eventCount >= CRITICAL_CUT_CONFIRMATION_EVENTS;
