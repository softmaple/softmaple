import { OPERATION_TYPE } from "../../constants/operation-types";
import { LinearEventBatch } from "../../graph/internals/packed-linear-chain";
import type { EventId, GraphEvent, Version } from "../../types";
import { isWellFormedUtf16 } from "../invariants";

/**
 * Read caller-owned remote events that form one exact causal chain from
 * `currentVersion` into a detached {@link LinearEventBatch}.
 *
 * The first event's parents must equal `currentVersion` and every later
 * event's only parent must be the event before it. Fields are checked as
 * {@link cloneRemoteEvent} checks them, in the same order, but are copied
 * into columns instead of a new event object, operation and parent set per
 * event. Each field is read once.
 *
 * Returns `null` when the events are not such a chain or any field would be
 * rejected. The caller's general path then reports the error or handles the
 * batch shape; this function never throws for bad input.
 */
export const readRemoteLinearBatch = (
  events: ReadonlyArray<GraphEvent>,
  currentVersion: Version,
): LinearEventBatch | null => {
  let batch: LinearEventBatch | null = null;
  let previousId: EventId = "";
  for (let offset = 0; offset < events.length; offset++) {
    const event = events[offset] as unknown;
    if (typeof event !== "object" || event === null) {
      return null;
    }
    const candidate = event as Record<string, unknown>;
    const id = candidate.id;
    if (typeof id !== "string" || id.length === 0) {
      return null;
    }
    const parentVersion = candidate.parentVersion;
    if (!(parentVersion instanceof Set)) {
      return null;
    }
    if (batch === null) {
      const parents = readRootParents(parentVersion, currentVersion, id);
      if (parents === null) {
        return null;
      }
      batch = new LinearEventBatch(parents);
    } else if (!hasOnlyParent(parentVersion, previousId)) {
      // An event naming itself as parent repeats the previous ID, which the
      // graph append rejects as a duplicate; the general path then reports
      // it. Comparing ID contents here would read every ID string twice.
      return null;
    }
    const timestamp = candidate.timestamp;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
      return null;
    }
    const operation = candidate.operation;
    if (operation === null || typeof operation !== "object") {
      return null;
    }
    const fields = operation as Record<string, unknown>;
    const type = fields.type;
    const index = fields.index;
    if (!isNonNegativeSafeInteger(index)) {
      return null;
    }
    if (type === OPERATION_TYPE.INSERT) {
      const text = fields.text;
      if (typeof text !== "string" || !isWellFormedUtf16(text)) {
        return null;
      }
      batch.appendInsert(id, index, text, timestamp);
    } else if (type === OPERATION_TYPE.DELETE) {
      const length = fields.length;
      if (!isNonNegativeSafeInteger(length)) {
        return null;
      }
      batch.appendDelete(id, index, length, timestamp);
    } else {
      return null;
    }
    previousId = id;
  }
  return batch?.finish() ?? null;
};

/**
 * Copy the first event's parents when they are exactly `currentVersion`,
 * iterating the caller's set once as {@link cloneRemoteEvent} does.
 */
const readRootParents = (
  parentVersion: ReadonlySet<unknown>,
  currentVersion: Version,
  eventId: EventId,
): Set<EventId> | null => {
  const parents = new Set<EventId>();
  for (const parentId of parentVersion) {
    if (
      typeof parentId !== "string" ||
      parentId === eventId ||
      !currentVersion.has(parentId)
    ) {
      return null;
    }
    parents.add(parentId);
  }
  return parents.size === currentVersion.size ? parents : null;
};

const hasOnlyParent = (
  parentVersion: ReadonlySet<unknown>,
  parentId: EventId,
): boolean => {
  let found = false;
  for (const candidate of parentVersion) {
    if (candidate !== parentId) {
      return false;
    }
    found = true;
  }
  return found;
};

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
