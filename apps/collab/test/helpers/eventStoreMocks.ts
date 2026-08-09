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

export class MockEventAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventAuthorizationError";
  }
}

export const eventStoreRouteMocks = {
  EventAuthorizationError: MockEventAuthorizationError,
  EventConflictError: MockEventConflictError,
};
