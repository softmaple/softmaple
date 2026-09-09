import {
  type DirectionalSelectionRange,
  isDirectionalSelectionRange,
  normalizePresenceSelection,
  type PresenceUser,
} from "../types/presence";
import { isRecord, isShortString } from "./envelope";
import { isPresenceUser } from "./member";

export interface AttentionInvitation {
  readonly id: string;
  readonly anchor: DirectionalSelectionRange;
  readonly recipients: readonly string[];
  readonly createdAt: number;
  readonly expiresAt: number;
}
export interface FollowRelationship {
  readonly sessionId: string;
  readonly connectionId: string;
  readonly status: "following" | "suspended";
}
export interface CollaborationState {
  readonly revision: number;
  readonly presenting: boolean;
  readonly following: FollowRelationship | null;
  readonly invitation: AttentionInvitation | null;
  readonly response: {
    readonly invitationId: string;
    readonly senderSessionId: string;
    readonly outcome: "accepted" | "dismissed";
    readonly expiresAt: number;
  } | null;
}
export type AttentionAction =
  | {
      readonly type: "invite";
      readonly anchor: DirectionalSelectionRange;
      readonly recipients: readonly string[];
    }
  | {
      readonly type: "respond";
      readonly senderSessionId: string;
      readonly invitationId: string;
      readonly outcome: "accepted" | "dismissed";
    }
  | { readonly type: "cancel"; readonly invitationId: string }
  | { readonly type: "present"; readonly enabled: boolean }
  | { readonly type: "follow"; readonly sessionId: string }
  | { readonly type: "suspend" | "resume" | "stop" };
export interface AttentionCommand {
  readonly id: string;
  readonly action: AttentionAction;
}
export interface AttentionResult {
  readonly id: string;
  readonly ok: boolean;
  readonly message?: string;
}
export interface AttentionProtocolContext {
  readonly sessionId: string;
  readonly sharedAttention: 1;
}
export const emptyCollaborationState = (): CollaborationState => ({
  revision: 0,
  presenting: false,
  following: null,
  invitation: null,
  response: null,
});

export const parseAttentionContext = (
  value: unknown,
): AttentionProtocolContext | undefined =>
  isRecord(value) &&
  value.sharedAttention === 1 &&
  isShortString(value.sessionId, 128)
    ? { sharedAttention: 1, sessionId: value.sessionId }
    : undefined;

export const parseAttentionCommand = (value: unknown): AttentionCommand => {
  if (
    !isRecord(value) ||
    !isShortString(value.id, 128) ||
    !isRecord(value.action)
  )
    throw new Error("Invalid attention action.");
  const action = value.action;
  switch (action.type) {
    case "invite": {
      const anchor = normalizePresenceSelection(action.anchor);
      if (
        !isDirectionalSelectionRange(anchor) ||
        !Array.isArray(action.recipients) ||
        action.recipients.length < 1 ||
        action.recipients.length > 100 ||
        !action.recipients.every((id) => isShortString(id, 128))
      )
        throw new Error("Choose a passage and people in this document.");
      return {
        id: value.id,
        action: {
          type: "invite",
          anchor,
          recipients: [...new Set(action.recipients as string[])],
        },
      };
    }
    case "respond":
      if (
        !isShortString(action.senderSessionId, 128) ||
        !isShortString(action.invitationId, 128) ||
        (action.outcome !== "accepted" && action.outcome !== "dismissed")
      )
        throw new Error("Invalid invitation response.");
      return {
        id: value.id,
        action: {
          type: "respond",
          senderSessionId: action.senderSessionId,
          invitationId: action.invitationId,
          outcome: action.outcome,
        },
      };
    case "cancel":
      if (!isShortString(action.invitationId, 128))
        throw new Error("Invalid invitation.");
      return {
        id: value.id,
        action: { type: "cancel", invitationId: action.invitationId },
      };
    case "present":
      if (typeof action.enabled !== "boolean")
        throw new Error("Invalid presentation state.");
      return {
        id: value.id,
        action: { type: "present", enabled: action.enabled },
      };
    case "follow":
      if (!isShortString(action.sessionId, 128))
        throw new Error("Choose a presenter.");
      return {
        id: value.id,
        action: { type: "follow", sessionId: action.sessionId },
      };
    case "suspend":
    case "resume":
    case "stop":
      return { id: value.id, action: { type: action.type } };
    default:
      throw new Error("Unknown attention action.");
  }
};

/** Server-owned, bounded deduplication history; never sent to clients. */
export type AttentionMember = PresenceUser & {
  readonly attentionReceipts?: readonly {
    readonly id: string;
    readonly at: number;
  }[];
};

/** Pure server transition. Membership is fresh and authenticated by the room. */
export const applyAttentionCommand = (
  self: AttentionMember,
  members: readonly PresenceUser[],
  command: AttentionCommand,
  now: number,
): AttentionMember => {
  if (self.sessionId === undefined || self.collaboration === undefined)
    throw new Error("Shared attention is unavailable in this session.");
  const receipts = (self.attentionReceipts ?? []).filter(
    (item) => now - item.at < 30_000,
  );
  if (receipts.some((item) => item.id === command.id)) return self;
  if (receipts.filter((item) => now - item.at < 1_000).length >= 4)
    throw new Error("Please wait a moment before sending another action.");
  const live = (sessionId: string) =>
    members.find(
      (member) =>
        member.sessionId === sessionId &&
        member.status !== "offline" &&
        member.collaboration !== undefined,
    );
  let state = self.collaboration;
  const action = command.action;
  switch (action.type) {
    case "invite": {
      if (state.invitation !== null && now - state.invitation.createdAt < 5_000)
        throw new Error("Please wait before inviting again.");
      if (
        action.recipients.some(
          (id) => id === self.sessionId || live(id) === undefined,
        )
      )
        throw new Error("A recipient is no longer available in this document.");
      state = {
        ...state,
        invitation: {
          id: command.id,
          anchor: action.anchor,
          recipients: action.recipients,
          createdAt: now,
          expiresAt: now + 30_000,
        },
      };
      break;
    }
    case "respond": {
      const sender = live(action.senderSessionId);
      const invitation = sender?.collaboration?.invitation;
      if (
        invitation == null ||
        invitation.id !== action.invitationId ||
        invitation.expiresAt <= now ||
        !invitation.recipients.includes(self.sessionId)
      )
        throw new Error("This invitation has expired or is unavailable.");
      state = {
        ...state,
        response: {
          invitationId: invitation.id,
          senderSessionId: action.senderSessionId,
          outcome: action.outcome,
          expiresAt: invitation.expiresAt,
        },
      };
      break;
    }
    case "cancel":
      if (state.invitation?.id === action.invitationId)
        state = { ...state, invitation: null };
      break;
    case "present":
      if (action.enabled && state.following !== null)
        throw new Error("Stop following before presenting.");
      state = { ...state, presenting: action.enabled };
      break;
    case "follow": {
      if (state.presenting)
        throw new Error("Stop presenting before following.");
      const target = live(action.sessionId);
      if (
        target === undefined ||
        target.sessionId === self.sessionId ||
        !target.collaboration?.presenting ||
        target.collaboration.following !== null
      )
        throw new Error("This person is not presenting.");
      state = {
        ...state,
        following: {
          sessionId: action.sessionId,
          connectionId: target.connectionId,
          status: "following",
        },
      };
      break;
    }
    case "suspend":
      if (state.following !== null)
        state = {
          ...state,
          following: { ...state.following, status: "suspended" },
        };
      break;
    case "resume": {
      const target =
        state.following === null ? undefined : live(state.following.sessionId);
      if (
        target === undefined ||
        !target.collaboration?.presenting ||
        target.collaboration.following !== null
      )
        throw new Error("The presenter is unavailable. Return to your place.");
      state = {
        ...state,
        following: {
          sessionId: target.sessionId ?? target.connectionId,
          connectionId: target.connectionId,
          status: "following",
        },
      };
      break;
    }
    case "stop":
      state = { ...state, following: null };
      break;
  }
  return {
    ...self,
    collaboration: { ...state, revision: state.revision + 1 },
    attentionReceipts: [...receipts, { id: command.id, at: now }].slice(-32),
  };
};

/** Filter by capability and audience; internal receipts never leave the server. */
export const visibleAttentionMember = (
  member: AttentionMember,
  context: unknown,
): PresenceUser => {
  const {
    attentionReceipts: _receipts,
    collaboration,
    sessionId,
    ...basic
  } = member;
  const supported = parseAttentionContext(context);
  if (supported === undefined || collaboration === undefined) return basic;
  const invitation = collaboration.invitation;
  return {
    ...basic,
    sessionId,
    collaboration: {
      ...collaboration,
      invitation:
        invitation !== null &&
        (sessionId === supported.sessionId ||
          invitation.recipients.includes(supported.sessionId))
          ? invitation
          : null,
    },
  };
};

export const normalizeCollaborationState = (
  value: unknown,
): CollaborationState | null => {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    typeof value.presenting !== "boolean"
  )
    return null;
  let following: FollowRelationship | null = null;
  if (value.following !== null) {
    const follow = value.following;
    if (
      !isRecord(follow) ||
      !isShortString(follow.sessionId, 128) ||
      !isShortString(follow.connectionId, 256) ||
      (follow.status !== "following" && follow.status !== "suspended")
    )
      return null;
    following = {
      sessionId: follow.sessionId,
      connectionId: follow.connectionId,
      status: follow.status,
    };
  }
  let invitation: AttentionInvitation | null = null;
  if (value.invitation !== null) {
    const invite = value.invitation;
    if (
      !isRecord(invite) ||
      !isShortString(invite.id, 128) ||
      typeof invite.createdAt !== "number" ||
      !Number.isFinite(invite.createdAt) ||
      typeof invite.expiresAt !== "number" ||
      !Number.isFinite(invite.expiresAt)
    )
      return null;
    try {
      const parsed = parseAttentionCommand({
        id: invite.id,
        action: {
          type: "invite",
          anchor: invite.anchor,
          recipients: invite.recipients,
        },
      });
      if (parsed.action.type !== "invite") return null;
      invitation = {
        id: invite.id,
        anchor: parsed.action.anchor,
        recipients: parsed.action.recipients,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
      };
    } catch {
      return null;
    }
  }
  let response: CollaborationState["response"] = null;
  if (value.response !== null) {
    const item = value.response;
    if (
      !isRecord(item) ||
      !isShortString(item.invitationId, 128) ||
      !isShortString(item.senderSessionId, 128) ||
      (item.outcome !== "accepted" && item.outcome !== "dismissed") ||
      typeof item.expiresAt !== "number" ||
      !Number.isFinite(item.expiresAt)
    )
      return null;
    response = {
      invitationId: item.invitationId,
      senderSessionId: item.senderSessionId,
      outcome: item.outcome,
      expiresAt: item.expiresAt,
    };
  }
  return {
    revision: value.revision as number,
    presenting: value.presenting,
    following,
    invitation,
    response,
  };
};

/** Host codecs use one filter for direct sends and cross-instance fanout. */
export const filterAttentionFrame = (
  frame: unknown,
  context: unknown,
): unknown | null => {
  if (!isRecord(frame)) return frame;
  const extension = parseAttentionContext(context);
  if (frame.type === "auth_ok")
    return {
      ...frame,
      payload:
        extension === undefined ? {} : { extensions: { sharedAttention: 1 } },
    };
  const payload = frame.payload;
  if (frame.type === "attention:state") {
    if (extension === undefined || !isRecord(payload)) return null;
    if (payload.ok === false) {
      const request = isRecord(payload.request) ? payload.request : {};
      return {
        ...frame,
        payload: { id: request.id, ok: false, message: payload.message },
      };
    }
    if (!isPresenceUser(payload.member)) return null;
    return {
      ...frame,
      payload: {
        ...payload,
        member: visibleAttentionMember(payload.member, context),
      },
    };
  }
  if (
    frame.type === "join" &&
    isRecord(payload) &&
    isPresenceUser(payload.user)
  ) {
    return {
      ...frame,
      payload: { user: visibleAttentionMember(payload.user, context) },
    };
  }
  if (
    (frame.type === "presence:sync-response" ||
      frame.type === "presence:sync") &&
    isRecord(payload) &&
    Array.isArray(payload.users)
  ) {
    return {
      ...frame,
      payload: {
        users: payload.users
          .filter(isPresenceUser)
          .map((member) => visibleAttentionMember(member, context)),
      },
    };
  }
  return frame;
};
