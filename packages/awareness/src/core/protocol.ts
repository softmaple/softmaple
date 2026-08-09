/**
 * Protocol version and capability bits for Softmaple awareness.
 */

export const PRESENCE_PROTOCOL_VERSION = 2 as const;

export const PRESENCE_CAPABILITIES = {
  /** Separated lastActivityAt / lastSeenAt clocks */
  activityLivenessSplit: true,
  /** Ephemeral connectionId distinct from userId */
  connectionId: true,
  /** Monotonic per-connection clock on presence updates */
  presenceClock: true,
  /** Auth + sync handshake before "connected" */
  readyHandshake: true,
  /** Heartbeat pingId + ACK deadline */
  heartbeatAck: true,
  /** Stable sequence-anchor cursors */
  stableCursor: true,
} as const;

export type PresenceCapability = keyof typeof PRESENCE_CAPABILITIES;

export interface PresenceHello {
  readonly protocolVersion: typeof PRESENCE_PROTOCOL_VERSION;
  readonly capabilities: typeof PRESENCE_CAPABILITIES;
  readonly connectionId: string;
  readonly userId: string;
}
