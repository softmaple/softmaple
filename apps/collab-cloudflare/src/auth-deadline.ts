import { INITIAL_AUTH_TIMEOUT_MS } from "./constants";

/** Close code and reason a room object answers an expired deadline with. */
export const AUTH_DEADLINE_CLOSE_CODE = 1008;
export const AUTH_DEADLINE_CLOSE_REASON = "Authentication timed out";

/**
 * A socket a room object accepted but that has not authenticated yet, paired
 * with the instant its authentication deadline expires.
 */
export interface PendingAuthSocket {
  readonly deadline: number;
  readonly socket: WebSocket;
}

export interface AuthDeadlineSweep {
  /** Sockets past their deadline; the caller closes and releases each one. */
  readonly expired: readonly WebSocket[];
  /** Earliest deadline still ahead, or `null` when nothing is pending. */
  readonly nextDeadline: number | null;
}

/** The instant a socket accepted at `connectedAt` must have authenticated by. */
export const authDeadlineFrom = (connectedAt: number): number =>
  connectedAt + INITIAL_AUTH_TIMEOUT_MS;

/**
 * Reads the pending sockets off the hibernation API's own socket list. The
 * caller supplies the accepted-at instant from each socket's attachment, so
 * this works identically on a live object and on one the alarm just woke
 * from hibernation with no in-memory state. Sockets already closing are
 * skipped: they are leaving on their own.
 */
export const collectPendingAuthSockets = (
  sockets: Iterable<WebSocket>,
  connectedAtOf: (socket: WebSocket) => number | null,
): readonly PendingAuthSocket[] =>
  [...sockets].flatMap((socket) => {
    if (socket.readyState >= WebSocket.CLOSING) return [];
    const connectedAt = connectedAtOf(socket);
    return connectedAt === null
      ? []
      : [{ deadline: authDeadlineFrom(connectedAt), socket }];
  });

export const earliestAuthDeadline = (
  pending: readonly PendingAuthSocket[],
): number | null =>
  pending.reduce<number | null>(
    (earliest, { deadline }) =>
      earliest === null ? deadline : Math.min(earliest, deadline),
    null,
  );

/** Splits the pending sockets into what expires now and when to wake next. */
export const planAuthDeadlineSweep = (
  pending: readonly PendingAuthSocket[],
  now: number,
): AuthDeadlineSweep => ({
  expired: pending
    .filter(({ deadline }) => deadline <= now)
    .map(({ socket }) => socket),
  nextDeadline: earliestAuthDeadline(
    pending.filter(({ deadline }) => deadline > now),
  ),
});

/**
 * Moves the object's alarm earlier, never later. A Durable Object has exactly
 * one alarm, and a room object may already have other work scheduled on it
 * (`PresenceRoomDO`'s liveness sweep), so an authentication deadline may only
 * pull an existing wake-up forward — never push it back or cancel it. A
 * deadline already in the past schedules an immediate wake-up.
 */
export const scheduleAlarmAt = async (
  storage: DurableObjectStorage,
  at: number | null,
): Promise<void> => {
  if (at === null) return;
  const scheduled = await storage.getAlarm();
  if (scheduled === null || scheduled > at) await storage.setAlarm(at);
};
