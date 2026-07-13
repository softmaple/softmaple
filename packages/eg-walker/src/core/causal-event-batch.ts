import { OPERATION_TYPE } from "../constants/operation-types";
import type { EventId, GraphEvent } from "../types";
import { assertWellFormedUtf16 } from "./invariants";

const causalEventBatchBrand: unique symbol = Symbol("CausalEventBatch");

/**
 * An owned, causally ordered event batch prepared for the strict remote-apply
 * path.
 *
 * The event payload is intentionally opaque. This keeps callers from
 * retaining or mutating event objects after transferring them to a replica.
 */
export interface CausalEventBatch {
  readonly eventCount: number;
  readonly [causalEventBatchBrand]: true;
}

/**
 * Builds an owned event batch without allocating an input wrapper per event.
 * A builder is one-shot: {@link finish} permanently closes it.
 */
export interface CausalEventBatchBuilder {
  readonly eventCount: number;

  appendInsert(
    id: EventId,
    parentVersion: Iterable<EventId>,
    index: number,
    text: string,
    timestamp: number,
  ): this;

  appendDelete(
    id: EventId,
    parentVersion: Iterable<EventId>,
    index: number,
    length: number,
    timestamp: number,
  ): this;

  finish(): CausalEventBatch;
}

interface CausalEventBatchState {
  events: ReadonlyArray<GraphEvent> | null;
}

const batchStates = new WeakMap<CausalEventBatch, CausalEventBatchState>();
const ownedEvents = new WeakSet<GraphEvent>();

class CausalEventBatchBuilderImplementation implements CausalEventBatchBuilder {
  #events: GraphEvent[];
  #eventCount = 0;
  #finished = false;
  #appending = false;

  constructor(capacity: number) {
    this.#events = new Array<GraphEvent>(assertValidCapacity(capacity));
  }

  get eventCount(): number {
    return this.#eventCount;
  }

  appendInsert(
    id: EventId,
    parentVersion: Iterable<EventId>,
    index: number,
    text: string,
    timestamp: number,
  ): this {
    this.assertOpen();
    this.assertNotAppending();
    this.#appending = true;
    try {
      assertValidEventId(id);
      assertValidIndex(index, id);
      if (typeof text !== "string") {
        throw new Error(`causal event ${id} insert text must be a string`);
      }
      assertWellFormedUtf16(text, `causal event ${id} insert text`);
      assertValidTimestamp(timestamp, id);
      const parents = copyParentVersion(id, parentVersion);

      this.appendOwnedEvent({
        id,
        parentVersion: parents,
        operation: { type: OPERATION_TYPE.INSERT, index, text },
        timestamp,
      });
      return this;
    } finally {
      this.#appending = false;
    }
  }

  appendDelete(
    id: EventId,
    parentVersion: Iterable<EventId>,
    index: number,
    length: number,
    timestamp: number,
  ): this {
    this.assertOpen();
    this.assertNotAppending();
    this.#appending = true;
    try {
      assertValidEventId(id);
      assertValidIndex(index, id);
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new Error(
          `causal event ${id} delete length must be a non-negative safe integer`,
        );
      }
      assertValidTimestamp(timestamp, id);
      const parents = copyParentVersion(id, parentVersion);

      this.appendOwnedEvent({
        id,
        parentVersion: parents,
        operation: { type: OPERATION_TYPE.DELETE, index, length },
        timestamp,
      });
      return this;
    } finally {
      this.#appending = false;
    }
  }

  finish(): CausalEventBatch {
    this.assertOpen();
    this.assertNotAppending();
    this.#finished = true;

    const events = this.#events;
    events.length = this.#eventCount;
    this.#events = [];

    const batchCandidate = { eventCount: this.#eventCount };
    Object.defineProperty(batchCandidate, causalEventBatchBrand, {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });
    const batch = Object.freeze(batchCandidate) as CausalEventBatch;
    batchStates.set(batch, { events });
    return batch;
  }

  private appendOwnedEvent(event: GraphEvent): void {
    this.#events[this.#eventCount] = event;
    ownedEvents.add(event);
    this.#eventCount++;
  }

  private assertOpen(): void {
    if (this.#finished) {
      throw new Error("Causal event batch builder is already finished");
    }
  }

  private assertNotAppending(): void {
    if (this.#appending) {
      throw new Error("Causal event batch builder cannot be used reentrantly");
    }
  }
}

/**
 * Create a one-shot causal event batch builder.
 *
 * `capacity` is an optional exact-or-upper-bound allocation hint. Appending
 * more events remains supported, and finishing below the hint trims the
 * transferred array without copying its event objects.
 */
export const createCausalEventBatchBuilder = (
  capacity = 0,
): CausalEventBatchBuilder =>
  new CausalEventBatchBuilderImplementation(capacity);

/** @internal Return whether a value was created by this module. */
export const isOwnedCausalEventBatch = (
  value: unknown,
): value is CausalEventBatch =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  batchStates.has(value as CausalEventBatch);

/** @internal Return whether an event is final storage owned by this module. */
export const isOwnedCausalEvent = (value: unknown): value is GraphEvent =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  ownedEvents.has(value as GraphEvent);

/**
 * @internal Borrow the batch's owned events for an apply attempt.
 *
 * This operation does not consume the batch. A caller must invoke
 * {@link consumeCausalEventBatch} only after its transaction commits, which
 * leaves the same batch reusable after validation or integration failure.
 */
export const inspectCausalEventBatch = (
  batch: CausalEventBatch,
): ReadonlyArray<GraphEvent> => {
  const state = getOwnedBatchState(batch);
  if (state.events === null) {
    throw new Error("Causal event batch is already consumed");
  }
  return state.events;
};

/** @internal Mark a successfully applied batch consumed and release events. */
export const consumeCausalEventBatch = (batch: CausalEventBatch): void => {
  const state = getOwnedBatchState(batch);
  if (state.events === null) {
    throw new Error("Causal event batch is already consumed");
  }
  state.events = null;
};

const getOwnedBatchState = (batch: CausalEventBatch): CausalEventBatchState => {
  const state = batchStates.get(batch);
  if (state === undefined) {
    throw new Error("Causal event batch is not owned by this module");
  }
  return state;
};

const assertValidCapacity = (capacity: number): number => {
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 0 ||
    capacity > 0xffff_ffff
  ) {
    throw new Error(
      "Causal event batch capacity must be a valid non-negative array length",
    );
  }
  return capacity;
};

const assertValidEventId = (id: EventId): void => {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Causal event id must be a non-empty string");
  }
};

const assertValidIndex = (index: number, eventId: EventId): void => {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(
      `causal event ${eventId} index must be a non-negative safe integer`,
    );
  }
};

const assertValidTimestamp = (timestamp: number, eventId: EventId): void => {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    throw new Error(`causal event ${eventId} timestamp must be finite`);
  }
};

const copyParentVersion = (
  eventId: EventId,
  parentVersion: Iterable<EventId>,
): Set<EventId> => {
  if (!isIterable(parentVersion)) {
    throw new Error(
      `causal event ${eventId} parentVersion must be an iterable of event IDs`,
    );
  }

  const copy = new Set<EventId>();
  for (const parentId of parentVersion) {
    if (typeof parentId !== "string" || parentId.length === 0) {
      throw new Error(`causal event ${eventId} has an invalid parent event ID`);
    }
    if (parentId === eventId) {
      throw new Error(`causal event ${eventId} cannot parent itself`);
    }
    copy.add(parentId);
  }
  return copy;
};

const isIterable = (value: unknown): value is Iterable<unknown> => {
  if (value === null || value === undefined) {
    return false;
  }
  return (
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
    "function"
  );
};
