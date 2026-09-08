import { isRecord } from "../protocol/envelope";
import {
  isPresenceSelection,
  isStableCursorPosition,
  type PresenceSelection,
  type StableCursorPosition,
} from "../types/presence";
import {
  ATTENTION_COMMAND,
  type AttentionAnchor,
  type AttentionCommand,
  type AttentionInvitation,
  type AttentionState,
  FOREGROUND,
  type Foreground,
  SESSION_ACTIVITY,
  type SemanticLocation,
  type SessionActivity,
} from "./types";

/**
 * Parsing attention frames off the wire.
 *
 * Every field is validated before it is believed. Attention commands move
 * other people's viewports, so a malformed or hostile frame must be rejected
 * at the boundary rather than reasoned about later, and each parser throws
 * with a specific message so a failure names the field that caused it.
 */

const MAX_NOTE_LENGTH = 140;
const MAX_RECIPIENTS = 50;
const MAX_TITLE_LENGTH = 200;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isForeground = (value: unknown): value is Foreground =>
  value === FOREGROUND.Foreground || value === FOREGROUND.Background;

const isActivity = (value: unknown): value is SessionActivity =>
  value === SESSION_ACTIVITY.Editing ||
  value === SESSION_ACTIVITY.Viewing ||
  value === SESSION_ACTIVITY.Idle;

export const parseSemanticLocation = (value: unknown): SemanticLocation => {
  if (!isRecord(value)) throw new Error("location must be an object");
  const { sectionId, sectionIndex, title } = value;
  if (sectionId !== null && !isNonEmptyString(sectionId)) {
    throw new Error("location.sectionId must be a string or null");
  }
  if (!Number.isSafeInteger(sectionIndex) || (sectionIndex as number) < 0) {
    throw new Error("location.sectionIndex must be a non-negative integer");
  }
  if (typeof title !== "string") {
    throw new Error("location.title must be a string");
  }
  return Object.freeze({
    sectionId,
    sectionIndex: sectionIndex as number,
    title: title.slice(0, MAX_TITLE_LENGTH),
  });
};

export const parseAttentionState = (value: unknown): AttentionState => {
  if (!isRecord(value)) throw new Error("attention state must be an object");
  if (!isActivity(value.activity)) {
    throw new Error("attention state activity is not recognised");
  }
  if (!isForeground(value.foreground)) {
    throw new Error("attention state foreground is not recognised");
  }
  if (typeof value.presenting !== "boolean") {
    throw new Error("attention state presenting must be a boolean");
  }
  if (
    value.followingSessionId !== null &&
    !isNonEmptyString(value.followingSessionId)
  ) {
    throw new Error("followingSessionId must be a session id or null");
  }
  return Object.freeze({
    activity: value.activity,
    foreground: value.foreground,
    location:
      value.location === null || value.location === undefined
        ? null
        : parseSemanticLocation(value.location),
    presenting: value.presenting,
    followingSessionId: value.followingSessionId,
  });
};

const parseAnchor = (value: unknown): AttentionAnchor => {
  if (!isRecord(value)) throw new Error("anchor must be an object");
  if (!isStableCursorPosition(value.cursor)) {
    throw new Error("anchor.cursor must be a stable cursor position");
  }
  if (value.selection !== undefined && !isPresenceSelection(value.selection)) {
    throw new Error("anchor.selection is not a valid selection");
  }
  return Object.freeze({
    cursor: value.cursor as StableCursorPosition,
    location:
      value.location === null || value.location === undefined
        ? null
        : parseSemanticLocation(value.location),
    ...(value.selection === undefined
      ? {}
      : { selection: value.selection as PresenceSelection }),
  });
};

export const parseAttentionInvitation = (
  value: unknown,
): AttentionInvitation => {
  if (!isRecord(value)) throw new Error("invitation must be an object");
  const recipients = value.recipientSessionIds;
  if (
    !Array.isArray(recipients) ||
    recipients.length === 0 ||
    recipients.length > MAX_RECIPIENTS ||
    !recipients.every(isNonEmptyString)
  ) {
    throw new Error(
      `invitation must name between 1 and ${MAX_RECIPIENTS} recipients`,
    );
  }
  for (const field of [
    "id",
    "senderSessionId",
    "senderUserId",
    "senderName",
  ] as const) {
    if (!isNonEmptyString(value[field])) {
      throw new Error(`invitation.${field} must be a non-empty string`);
    }
  }
  if (!isTimestamp(value.issuedAt) || !isTimestamp(value.expiresAt)) {
    throw new Error("invitation timestamps must be non-negative numbers");
  }
  if (value.expiresAt <= value.issuedAt) {
    throw new Error("invitation must expire after it was issued");
  }
  if (value.note !== undefined && typeof value.note !== "string") {
    throw new Error("invitation.note must be a string when present");
  }
  return Object.freeze({
    anchor: parseAnchor(value.anchor),
    expiresAt: value.expiresAt,
    id: value.id as string,
    issuedAt: value.issuedAt,
    recipientSessionIds: Object.freeze([...(recipients as string[])]),
    senderName: value.senderName as string,
    senderSessionId: value.senderSessionId as string,
    senderUserId: value.senderUserId as string,
    ...(value.note === undefined
      ? {}
      : { note: (value.note as string).slice(0, MAX_NOTE_LENGTH) }),
  });
};

/** Fields every command carries. */
const parseCommandEnvelope = (
  value: unknown,
): { readonly id: string; readonly issuedAt: number } => {
  if (!isRecord(value)) throw new Error("command must be an object");
  if (!isNonEmptyString(value.id)) {
    throw new Error("command.id must be a non-empty string");
  }
  if (!isTimestamp(value.issuedAt)) {
    throw new Error("command.issuedAt must be a non-negative number");
  }
  return { id: value.id, issuedAt: value.issuedAt };
};

const requireSession = (value: unknown, field: string): string => {
  if (!isNonEmptyString(value)) {
    throw new Error(`command.${field} must be a session id`);
  }
  return value;
};

export const parseAttentionCommand = (value: unknown): AttentionCommand => {
  const { id, issuedAt } = parseCommandEnvelope(value);
  const record = value as Record<string, unknown>;

  switch (record.type) {
    case ATTENTION_COMMAND.Invite:
      return Object.freeze({
        type: ATTENTION_COMMAND.Invite,
        id,
        issuedAt,
        invitation: parseAttentionInvitation(record.invitation),
      });
    case ATTENTION_COMMAND.Cancel:
      return Object.freeze({
        type: ATTENTION_COMMAND.Cancel,
        id,
        issuedAt,
        invitationId: requireSession(record.invitationId, "invitationId"),
        senderSessionId: requireSession(
          record.senderSessionId,
          "senderSessionId",
        ),
      });
    case ATTENTION_COMMAND.Accept:
    case ATTENTION_COMMAND.Dismiss:
      return Object.freeze({
        type: record.type,
        id,
        issuedAt,
        invitationId: requireSession(record.invitationId, "invitationId"),
        recipientSessionId: requireSession(
          record.recipientSessionId,
          "recipientSessionId",
        ),
      });
    case ATTENTION_COMMAND.FollowStart:
    case ATTENTION_COMMAND.FollowStop:
      return Object.freeze({
        type: record.type,
        id,
        issuedAt,
        followerSessionId: requireSession(
          record.followerSessionId,
          "followerSessionId",
        ),
        presenterSessionId: requireSession(
          record.presenterSessionId,
          "presenterSessionId",
        ),
      });
    default:
      throw new Error(`unknown attention command type ${String(record.type)}`);
  }
};
