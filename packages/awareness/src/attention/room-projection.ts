import {
  ATTENTION_COMMAND,
  type AttentionCommand,
  type AttentionState,
} from "./types";
import { parseAttentionCommand } from "./wire";

/**
 * The awareness side of the presence-runtime seam.
 *
 * `@softmaple/collab-runtime` deliberately never imports awareness, so it
 * describes an attention command only by the facts it needs to route one. This
 * module is where a full awareness command is narrowed to those facts, and
 * where a stored `PresenceUser` is narrowed to the three attention fields the
 * room consults. Both host codecs use it, so neither can drift from the other.
 */

/** Wire types added by version 3. */
export const ATTENTION_WIRE_TYPE = {
  /** Client → server, and server → each addressed recipient. */
  Command: "attention",
  /** Server → sender: what became of the command. */
  Outcome: "attention:outcome",
} as const;

/** Where attention state rides inside `PresenceUser.meta`. */
export const ATTENTION_META_KEY = "attention" as const;

/** The routing facts the room needs, mirroring `PresenceAttentionCommand`. */
export type RoomAttentionCommand = {
  readonly expiresAt: number | null;
  readonly id: string;
  readonly recipientSessionIds: ReadonlyArray<string>;
  readonly requiresPresenter: boolean;
  readonly senderSessionId: string;
  readonly targetSessionId: string | null;
};

/** The member fields the room consults, mirroring `PresenceMemberAttention`. */
export type RoomMemberAttention = {
  readonly followingSessionId: string | null;
  readonly presenting: boolean;
  readonly sessionId: string | null;
};

/**
 * Who a command is for, and who it is about.
 *
 * An answer (accept / dismiss) goes back to the session that sent the
 * invitation; an invitation goes to its addressees; a follow request goes to
 * the presenter. Getting this wrong would deliver an invitation to its own
 * author, so it is written out per command rather than inferred.
 */
const routingFor = (
  command: AttentionCommand,
): Pick<
  RoomAttentionCommand,
  | "expiresAt"
  | "recipientSessionIds"
  | "requiresPresenter"
  | "senderSessionId"
  | "targetSessionId"
> => {
  switch (command.type) {
    case ATTENTION_COMMAND.Invite:
      return {
        expiresAt: command.invitation.expiresAt,
        recipientSessionIds: command.invitation.recipientSessionIds,
        requiresPresenter: false,
        senderSessionId: command.invitation.senderSessionId,
        targetSessionId: null,
      };
    case ATTENTION_COMMAND.Cancel:
      return {
        expiresAt: null,
        recipientSessionIds: [command.senderSessionId],
        requiresPresenter: false,
        senderSessionId: command.senderSessionId,
        targetSessionId: null,
      };
    case ATTENTION_COMMAND.Accept:
    case ATTENTION_COMMAND.Dismiss:
      return {
        expiresAt: null,
        // The answer belongs to whoever asked. It is addressed back to them.
        recipientSessionIds: [command.recipientSessionId],
        requiresPresenter: false,
        senderSessionId: command.recipientSessionId,
        targetSessionId: null,
      };
    case ATTENTION_COMMAND.FollowStart:
      return {
        expiresAt: null,
        recipientSessionIds: [command.presenterSessionId],
        // Being watched is a decision; the room enforces the opt-in.
        requiresPresenter: true,
        senderSessionId: command.followerSessionId,
        targetSessionId: command.presenterSessionId,
      };
    case ATTENTION_COMMAND.FollowStop:
      return {
        expiresAt: null,
        recipientSessionIds: [command.presenterSessionId],
        // Stopping never needs permission.
        requiresPresenter: false,
        senderSessionId: command.followerSessionId,
        targetSessionId: null,
      };
  }
};

/**
 * Parse a wire payload and narrow it to the room's routing view.
 *
 * A cancel addressed to its own sender looks odd but is deliberate: cancelling
 * is broadcast to nobody, and the round trip is what tells the sender the
 * cancel was accepted.
 */
export const roomAttentionCommand = (
  payload: unknown,
): RoomAttentionCommand => {
  const command = parseAttentionCommand(payload);
  return Object.freeze({ id: command.id, ...routingFor(command) });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Read attention state off a stored member.
 *
 * Anything missing or malformed reads as "not presenting, not following,
 * no session" — the answer that refuses a follow rather than permitting one.
 */
export const roomMemberAttention = (member: unknown): RoomMemberAttention => {
  const meta = isRecord(member) ? member.meta : undefined;
  const attention = isRecord(meta) ? meta[ATTENTION_META_KEY] : undefined;
  if (!isRecord(attention)) {
    return { followingSessionId: null, presenting: false, sessionId: null };
  }
  return {
    followingSessionId:
      typeof attention.followingSessionId === "string"
        ? attention.followingSessionId
        : null,
    presenting: attention.presenting === true,
    sessionId:
      typeof attention.sessionId === "string" ? attention.sessionId : null,
  };
};

/** Pack attention state for `PresenceUser.meta`, for a client publishing it. */
export const attentionMeta = (
  state: AttentionState,
  sessionId: string,
): Record<string, unknown> => ({
  [ATTENTION_META_KEY]: {
    followingSessionId: state.followingSessionId,
    presenting: state.presenting,
    sessionId,
  },
});
