import {
  ATTENTION_INVITATION_TTL_MS,
  ATTENTION_REFUSAL,
  type AttentionInvitation,
  type AttentionOutcome,
  type AttentionRefusal,
} from "./types";

/**
 * The invitations a session is currently holding.
 *
 * An invitation is a deliberate act with a short life, which makes it the
 * opposite of presence state: it must not be coalesced, must not be replayed,
 * and must go away on its own. This registry is the one place those rules
 * live, so neither client nor server has to remember them separately.
 *
 * Everything is pure and takes `now` as an argument, so expiry is testable
 * without waiting and cannot drift with a slow event loop.
 */

export type InvitationRegistry = {
  /** Live invitations, newest first. */
  readonly invitations: ReadonlyArray<AttentionInvitation>;
  /** Command ids already applied, for duplicate detection. */
  readonly seenCommandIds: ReadonlySet<string>;
};

export const EMPTY_REGISTRY: InvitationRegistry = Object.freeze({
  invitations: Object.freeze([]),
  seenCommandIds: Object.freeze(new Set<string>()),
});

/**
 * How many command ids to remember.
 *
 * Bounded because a room can run for hours: the point is to catch a duplicate
 * from a retry or a reconnect, which arrives close behind the original, not to
 * keep a permanent ledger.
 */
export const SEEN_COMMAND_LIMIT = 256 as const;

const remember = (
  seen: ReadonlySet<string>,
  commandId: string,
): ReadonlySet<string> => {
  const next = [...seen, commandId];
  return new Set(
    next.length > SEEN_COMMAND_LIMIT
      ? next.slice(next.length - SEEN_COMMAND_LIMIT)
      : next,
  );
};

/** Drop invitations whose time is up. */
export const expireInvitations = (
  registry: InvitationRegistry,
  now: number,
): InvitationRegistry => {
  const live = registry.invitations.filter(
    (invitation) => invitation.expiresAt > now,
  );
  return live.length === registry.invitations.length
    ? registry
    : Object.freeze({ ...registry, invitations: Object.freeze(live) });
};

export type InvitationAdmission =
  | { readonly accepted: true; readonly registry: InvitationRegistry }
  | { readonly accepted: false; readonly reason: AttentionRefusal };

/**
 * Take delivery of an invitation addressed to this session.
 *
 * Refuses, with a reason, when the command is a duplicate, when the invitation
 * has already expired (a reconnect must not resurrect a stale gesture), or
 * when this session was not one of the addressees.
 */
export const receiveInvitation = ({
  commandId,
  invitation,
  now,
  registry,
  sessionId,
}: {
  readonly commandId: string;
  readonly invitation: AttentionInvitation;
  readonly now: number;
  readonly registry: InvitationRegistry;
  readonly sessionId: string;
}): InvitationAdmission => {
  if (registry.seenCommandIds.has(commandId)) {
    return { accepted: false, reason: ATTENTION_REFUSAL.Duplicate };
  }
  if (!invitation.recipientSessionIds.includes(sessionId)) {
    return { accepted: false, reason: ATTENTION_REFUSAL.NotAddressed };
  }
  if (invitation.expiresAt <= now) {
    return { accepted: false, reason: ATTENTION_REFUSAL.Expired };
  }

  const current = expireInvitations(registry, now);
  // A resent invitation with the same id replaces rather than duplicates:
  // the sender means one invitation, however many times it reached us.
  const others = current.invitations.filter(
    (existing) => existing.id !== invitation.id,
  );
  return {
    accepted: true,
    registry: Object.freeze({
      invitations: Object.freeze([invitation, ...others]),
      seenCommandIds: remember(current.seenCommandIds, commandId),
    }),
  };
};

/** Remove an invitation once it is answered, cancelled or expired. */
export const removeInvitation = (
  registry: InvitationRegistry,
  invitationId: string,
): InvitationRegistry => {
  const remaining = registry.invitations.filter(
    (invitation) => invitation.id !== invitationId,
  );
  return remaining.length === registry.invitations.length
    ? registry
    : Object.freeze({ ...registry, invitations: Object.freeze(remaining) });
};

/**
 * Answer an invitation.
 *
 * Accepting and dismissing take the same path because they have the same
 * effect on the registry: the invitation is spent either way, and the
 * difference is what the caller does next.
 */
export const answerInvitation = ({
  invitationId,
  now,
  registry,
}: {
  readonly invitationId: string;
  readonly now: number;
  readonly registry: InvitationRegistry;
}):
  | {
      readonly answered: true;
      readonly registry: InvitationRegistry;
      readonly invitation: AttentionInvitation;
    }
  | { readonly answered: false; readonly reason: AttentionRefusal } => {
  const current = expireInvitations(registry, now);
  const invitation = current.invitations.find(
    (candidate) => candidate.id === invitationId,
  );
  if (invitation === undefined) {
    return {
      answered: false,
      reason: registry.invitations.some(
        (candidate) => candidate.id === invitationId,
      )
        ? ATTENTION_REFUSAL.Expired
        : ATTENTION_REFUSAL.Unknown,
    };
  }
  return {
    answered: true,
    invitation,
    registry: removeInvitation(current, invitationId),
  };
};

/**
 * The single invitation to show.
 *
 * A stack of invitations is a queue of interruptions, so only the newest live
 * one is surfaced; the rest expire quietly. This is the "one invitation"
 * viewport cap, expressed where the data is rather than in a component.
 */
export const visibleInvitation = (
  registry: InvitationRegistry,
  now: number,
): AttentionInvitation | null =>
  expireInvitations(registry, now).invitations[0] ?? null;

/** Build an invitation with a correct expiry. */
export const createInvitation = ({
  anchor,
  id,
  note,
  now,
  recipientSessionIds,
  senderName,
  senderSessionId,
  senderUserId,
  ttlMs = ATTENTION_INVITATION_TTL_MS,
}: {
  readonly anchor: AttentionInvitation["anchor"];
  readonly id: string;
  readonly note?: string;
  readonly now: number;
  readonly recipientSessionIds: ReadonlyArray<string>;
  readonly senderName: string;
  readonly senderSessionId: string;
  readonly senderUserId: string;
  readonly ttlMs?: number;
}): AttentionInvitation => {
  if (recipientSessionIds.length === 0) {
    throw new Error("An invitation must name at least one recipient");
  }
  return Object.freeze({
    anchor,
    expiresAt: now + ttlMs,
    id,
    issuedAt: now,
    recipientSessionIds: Object.freeze([...recipientSessionIds]),
    senderName,
    senderSessionId,
    senderUserId,
    ...(note === undefined ? {} : { note }),
  });
};

/** A delivered outcome, for the sender. */
export const delivered = (
  commandId: string,
  deliveredToSessionIds: ReadonlyArray<string>,
): AttentionOutcome =>
  Object.freeze({
    status: "delivered",
    commandId,
    deliveredToSessionIds: Object.freeze([...deliveredToSessionIds]),
  });

/** A refusal, for the sender. Never silent. */
export const refused = (
  commandId: string,
  reason: AttentionRefusal,
): AttentionOutcome => Object.freeze({ status: "refused", commandId, reason });
