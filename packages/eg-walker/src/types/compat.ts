/**
 * Compatibility type exports for tests
 */

import type { GraphEvent, Version } from "./index";

// Export type aliases for backward compatibility
export type Event = GraphEvent;
export type SerializedEventGraph = {
  readonly version: Version;
  readonly events: ReadonlyArray<GraphEvent>;
  readonly metadata?: Record<string, unknown>;
};
