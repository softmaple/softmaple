/**
 * Application close codes for client-initiated collaboration WebSocket
 * shutdowns. Browsers only permit WebSocket.close(code) with 1000 or
 * 3000–4999; protocol codes such as 1008/1011 are valid on server-generated
 * close frames but throw InvalidAccessError when passed to the browser API.
 */
export const COLLAB_CLIENT_CLOSE_CODE = {
  InvalidServerResponse: 4008,
  RetryableServerError: 4011,
  FatalServerError: 4009,
  ResponseApplyFailure: 4012,
} as const;

export type CollabClientCloseCode =
  (typeof COLLAB_CLIENT_CLOSE_CODE)[keyof typeof COLLAB_CLIENT_CLOSE_CODE];

/** True when `code` is allowed by the browser WebSocket.close() API. */
export const isBrowserAllowedWebSocketCloseCode = (code: number): boolean =>
  code === 1000 || (code >= 3000 && code <= 4999);

/**
 * Close a collaboration socket with an application close code. Swallows
 * close()-time exceptions so they cannot hide collaboration errors the caller
 * already surfaced (e.g. via setError).
 */
export const closeCollabClientSocket = (
  socket: Pick<WebSocket, "close">,
  code: CollabClientCloseCode,
  reason: string,
): void => {
  try {
    socket.close(code, reason);
  } catch {
    // Intentionally ignored: InvalidAccessError / close races must not mask
    // the original collaboration failure reported by the message handler.
  }
};
