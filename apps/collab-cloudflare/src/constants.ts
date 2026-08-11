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
