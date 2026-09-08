/**
 * Shared attention: identity, state, invitations and following.
 *
 * These types are transport-independent on purpose. Everything here describes
 * *what* is being said between people in a room; how it is framed on the wire
 * belongs to the codecs, and how it is drawn belongs to the editor binding.
 */

import type {
  PresenceSelection,
  StableCursorPosition,
} from "../types/presence";

/**
 * A tab, for as long as it is open.
 *
 * `connectionId` is per socket and changes on every reconnect, which makes it
 * useless as the target of a follow: a two-second network blip would silently
 * end the relationship. `sessionId` is minted once per tab and survives
 * reconnects, so "follow that person's other window" keeps meaning the same
 * window. One person may hold several sessions at once; the roster groups them
 * by `userId`, while attention is always addressed to a session.
 */
export type SessionIdentity = {
  /** Stable for the life of the tab. Survives reconnects. */
  readonly sessionId: string;
  /** Ephemeral, per socket. */
  readonly connectionId: string;
  /** The account. Shared by all of that person's sessions. */
  readonly userId: string;
};

/** Whether a session's tab is in front of the person right now. */
export const FOREGROUND = {
  Foreground: "foreground",
  Background: "background",
} as const;

export type Foreground = (typeof FOREGROUND)[keyof typeof FOREGROUND];

/** What a session is doing, from its own signals only. */
export const SESSION_ACTIVITY = {
  Editing: "editing",
  Viewing: "viewing",
  Idle: "idle",
} as const;

export type SessionActivity =
  (typeof SESSION_ACTIVITY)[keyof typeof SESSION_ACTIVITY];

/**
 * Where somebody is, in terms a person can read.
 *
 * Deliberately coarser than a caret: a section survives edits that invalidate
 * an exact position, and it is the thing a return journey can actually resolve
 * to when the block somebody left has been deleted.
 */
export type SemanticLocation = {
  /** Heading block of the section, or `null` for the opening section. */
  readonly sectionId: string | null;
  /** Index of that section, for resolving a deleted section by position. */
  readonly sectionIndex: number;
  /** Human-readable section name, as it read when captured. */
  readonly title: string;
};

/**
 * The attention-related state a session publishes.
 *
 * This is coalescible: only the latest value matters, and dropping an
 * intermediate one loses nothing. Invitations and follow commands are *not*
 * part of it — see {@link AttentionCommand} — because dropping one of those
 * loses a deliberate act.
 */
export type AttentionState = {
  readonly activity: SessionActivity;
  readonly foreground: Foreground;
  /** `null` when the person has not opted into publishing a location. */
  readonly location: SemanticLocation | null;
  /**
   * This session has opted into being followed. Nobody can be followed
   * without setting it: being watched is a decision, not a side effect.
   */
  readonly presenting: boolean;
  /** The session this one is currently following, if any. */
  readonly followingSessionId: string | null;
};

export const DEFAULT_ATTENTION_STATE: AttentionState = Object.freeze({
  activity: SESSION_ACTIVITY.Viewing,
  foreground: FOREGROUND.Foreground,
  location: null,
  presenting: false,
  followingSessionId: null,
});

/** A place in the document that an invitation points at. */
export type AttentionAnchor = {
  readonly cursor: StableCursorPosition;
  /** Present when the invitation points at a passage rather than a caret. */
  readonly selection?: PresenceSelection;
  /** Coarse fallback for when the exact anchor no longer resolves. */
  readonly location: SemanticLocation | null;
};

/** How long an unanswered invitation stays live. */
export const ATTENTION_INVITATION_TTL_MS = 30_000 as const;

/**
 * "Look here."
 *
 * Addressed to specific sessions rather than broadcast, carries its own id so
 * a duplicate delivery is detectable, and expires on its own so an invitation
 * nobody answered cannot resurface later as a surprise.
 */
export type AttentionInvitation = {
  readonly anchor: AttentionAnchor;
  readonly expiresAt: number;
  readonly id: string;
  readonly issuedAt: number;
  /** Sessions this invitation is for. Never empty. */
  readonly recipientSessionIds: ReadonlyArray<string>;
  readonly senderSessionId: string;
  readonly senderName: string;
  readonly senderUserId: string;
  /** Optional one-line reason, shown verbatim to recipients. */
  readonly note?: string;
};

export const ATTENTION_COMMAND = {
  Invite: "attention:invite",
  Cancel: "attention:cancel",
  Accept: "attention:accept",
  Dismiss: "attention:dismiss",
  FollowStart: "follow:start",
  FollowStop: "follow:stop",
} as const;

export type AttentionCommandType =
  (typeof ATTENTION_COMMAND)[keyof typeof ATTENTION_COMMAND];

/**
 * A deliberate act, which must not be coalesced away.
 *
 * Every command carries an `id` so the receiver can drop a duplicate, and an
 * `issuedAt` so an out-of-order arrival can be recognised rather than applied.
 */
export type AttentionCommand =
  | {
      readonly type: typeof ATTENTION_COMMAND.Invite;
      readonly id: string;
      readonly issuedAt: number;
      readonly invitation: AttentionInvitation;
    }
  | {
      readonly type: typeof ATTENTION_COMMAND.Cancel;
      readonly id: string;
      readonly issuedAt: number;
      readonly invitationId: string;
      readonly senderSessionId: string;
    }
  | {
      readonly type: typeof ATTENTION_COMMAND.Accept;
      readonly id: string;
      readonly issuedAt: number;
      readonly invitationId: string;
      readonly recipientSessionId: string;
    }
  | {
      readonly type: typeof ATTENTION_COMMAND.Dismiss;
      readonly id: string;
      readonly issuedAt: number;
      readonly invitationId: string;
      readonly recipientSessionId: string;
    }
  | {
      readonly type: typeof ATTENTION_COMMAND.FollowStart;
      readonly id: string;
      readonly issuedAt: number;
      readonly followerSessionId: string;
      readonly presenterSessionId: string;
    }
  | {
      readonly type: typeof ATTENTION_COMMAND.FollowStop;
      readonly id: string;
      readonly issuedAt: number;
      readonly followerSessionId: string;
      readonly presenterSessionId: string;
    };

/** Why a command was refused. Every refusal names a reason. */
export const ATTENTION_REFUSAL = {
  /** The command's id was already seen. */
  Duplicate: "duplicate",
  /** The invitation had already expired when it arrived. */
  Expired: "expired",
  /** No such invitation, or it was already answered. */
  Unknown: "unknown",
  /** The addressee is not this session. */
  NotAddressed: "not-addressed",
  /** The target session is not in the room. */
  NoSuchSession: "no-such-session",
  /** The presenter has not opted into being followed. */
  NotPresenting: "not-presenting",
  /** Following would form a cycle. */
  Cycle: "cycle",
  /** The sender may not read this document. */
  Forbidden: "forbidden",
  /** Too many commands from one sender. */
  RateLimited: "rate-limited",
} as const;

export type AttentionRefusal =
  (typeof ATTENTION_REFUSAL)[keyof typeof ATTENTION_REFUSAL];

/**
 * What happened to a command.
 *
 * A command is never silently swallowed: the sender learns whether it was
 * delivered, and to whom.
 */
export type AttentionOutcome =
  | {
      readonly status: "delivered";
      readonly commandId: string;
      readonly deliveredToSessionIds: ReadonlyArray<string>;
    }
  | {
      readonly status: "refused";
      readonly commandId: string;
      readonly reason: AttentionRefusal;
    };
