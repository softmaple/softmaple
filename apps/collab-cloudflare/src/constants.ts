import {
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  type CollabErrorCode,
  type ServerCollabMessage,
  type SupportedCollabProtocolVersion,
} from "@softmaple/collab-protocol";

export const MESSAGE_RATE_LIMIT_WINDOW_MS = 10_000;
export const MESSAGE_RATE_LIMIT_MAX = 120;
export const MAX_MESSAGE_BYTES = 256 * 1024;
// WebSocket attachments are capped at 16 KiB by Cloudflare. Keep half of that
// budget for the Ready/session snapshot, quota, structured-clone overhead, and
// future versioned fields.
export const MAX_PERSISTED_AUTH_BYTES = 8 * 1024;
export const INITIAL_AUTH_TIMEOUT_MS = 10_000;

// Presence frames carry no document payload, so the transport limit can stay
// well below the document room's 256 KiB.
export const MAX_PRESENCE_MESSAGE_BYTES = 64 * 1024;
// Presence attachments carry no Ready/session snapshot, so half of the
// document room's 8 KiB budget is generous for identity + credential + quota.
export const MAX_PERSISTED_PRESENCE_BYTES = 4 * 1024;
// Cloudflare alarms are the only timer that survives hibernation; this
// backstops `PresenceRoom.sweep()` liveness at roughly the room's own
// heartbeat/member TTL cadence (`DEFAULT_PRESENCE_ROOM_POLICY`).
export const PRESENCE_ALARM_INTERVAL_MS = 30_000;

export const errorMessage = (
  code: CollabErrorCode,
  message: string,
  retryable: boolean,
  protocolVersion: SupportedCollabProtocolVersion = COLLAB_PROTOCOL_VERSION,
): ServerCollabMessage => ({
  protocolVersion,
  type: COLLAB_MESSAGE_TYPE.Error,
  code,
  message,
  retryable,
});

export const logError = (
  error: unknown,
  context: Readonly<Record<string, unknown>>,
): void => {
  console.error(
    JSON.stringify({
      ...context,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: "Cloudflare collaboration request failed",
    }),
  );
};

export const logMetric = (event: Readonly<Record<string, unknown>>): void => {
  console.log(
    JSON.stringify({ ...event, message: "Cloudflare collaboration metric" }),
  );
};
