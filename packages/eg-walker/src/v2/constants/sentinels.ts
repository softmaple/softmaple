/**
 * CRDT sentinel constants for boundary markers.
 * These special IDs mark the start and end of the CRDT sequence.
 */

export const CRDT_SENTINELS = {
  START_ID: "__START__",
  END_ID: "__END__",
} as const;

export type SentinelId = (typeof CRDT_SENTINELS)[keyof typeof CRDT_SENTINELS];
