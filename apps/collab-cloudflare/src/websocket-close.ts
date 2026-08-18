import { logError } from "./constants";

const NORMAL_CLOSURE = 1000;
// Reserved codes: a close event may report them, but a close frame must never
// carry one, so an unclean client close is answered with a normal closure.
const RESERVED_CLOSE_CODES: ReadonlySet<number> = new Set([
  1004, 1005, 1006, 1015,
]);

export interface CloseEchoFallback {
  /** Log context used when the echo itself fails. */
  readonly messageType: string;
  /** Reason sent when the client's own reason cannot be echoed back. */
  readonly reason: string;
}

export const echoableCloseCode = (code: number): number =>
  Number.isInteger(code) &&
  code >= 1000 &&
  code <= 4999 &&
  !RESERVED_CLOSE_CODES.has(code)
    ? code
    : NORMAL_CLOSURE;

/**
 * Answers the client's close frame, for either room object. A hibernatable
 * socket's closing handshake is the object's own responsibility: the runtime
 * reports the client's close through `webSocketClose` and sends no close
 * frame of its own, so an unanswered close leaves the browser waiting for its
 * half until it gives up with 1006. Both endpoints now own their whole
 * connection — no Worker-side socket sits in front of either — so both
 * complete the handshake here and their clients see a clean 1000.
 */
export const completeClose = (
  socket: WebSocket,
  code: number,
  reason: string,
  fallback: CloseEchoFallback,
): void => {
  // The socket is already CLOSING here — the client's frame arrived — so this
  // deliberately omits the `< CLOSING` guard a server-initiated close needs.
  if (socket.readyState === WebSocket.CLOSED) return;
  const echoed = echoableCloseCode(code);
  try {
    socket.close(echoed, echoed === code ? reason : fallback.reason);
  } catch (error) {
    logError(error, { messageType: fallback.messageType });
  }
};
