import type { EventConflictDetails } from "../../server/utils/event-conflict";

/**
 * Mock EventConflictError for vi.mock(".../event-store") factories.
 * Mirrors the production constructor (details required, no defaults).
 */
export class MockEventConflictError extends Error {
  readonly details: EventConflictDetails;

  constructor(message: string, details: EventConflictDetails) {
    super(message);
    this.name = "EventConflictError";
    this.details = details;
  }
}

export const eventStoreRouteMocks = {
  EventAuthorizationError: class EventAuthorizationError extends Error {},
  EventConflictError: MockEventConflictError,
};
