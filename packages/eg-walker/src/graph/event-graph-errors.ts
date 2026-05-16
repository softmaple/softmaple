import type { EventId } from "../types";

export class EventAlreadyExistsError extends Error {
  readonly eventId: EventId;

  constructor(eventId: EventId) {
    super(`Event ${eventId} already exists`);
    this.name = "EventAlreadyExistsError";
    this.eventId = eventId;
  }
}

export class MissingParentError extends Error {
  readonly parentId: EventId;

  constructor(parentId: EventId) {
    super(`Missing parent event: ${parentId}`);
    this.name = "MissingParentError";
    this.parentId = parentId;
  }
}
