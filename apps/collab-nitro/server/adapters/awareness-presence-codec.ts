import type { CollabCredential } from "@softmaple/collab-protocol";
import {
  PRESENCE_FRAME,
  PRESENCE_MESSAGE,
  type PresenceCodec,
  type PresenceFrameKind,
  type PresenceMemberRecord,
  type PresenceMessageKind,
  type PresencePatch,
} from "@softmaple/collab-runtime";
import {
  applyPresencePatch,
  applyAttentionCommand,
  parseAttentionCommand,
  parseAttentionContext,
  emptyCollaborationState,
  filterAttentionFrame,
  consumePresenceQuota,
  createPresenceMember,
  isPresenceUser,
  parsePresenceAuth,
  parsePresenceEnvelope,
  parsePresenceHeartbeatPingId,
  parsePresencePatch,
  WS_MESSAGE,
  type PresencePatch as AwarenessPresencePatch,
  type PresenceRateLimit,
} from "@softmaple/awareness/protocol";
import type { PresenceUser } from "@softmaple/awareness/types/presence";

const WIRE_TO_ROOM_MESSAGE: Partial<Record<string, PresenceMessageKind>> = {
  [WS_MESSAGE.ATTENTION_COMMAND]: PRESENCE_MESSAGE.Command,
  [WS_MESSAGE.AUTH]: PRESENCE_MESSAGE.Auth,
  [WS_MESSAGE.HEARTBEAT]: PRESENCE_MESSAGE.Heartbeat,
  [WS_MESSAGE.JOIN]: PRESENCE_MESSAGE.Join,
  [WS_MESSAGE.LEAVE]: PRESENCE_MESSAGE.Leave,
  [WS_MESSAGE.PRESENCE_SYNC]: PRESENCE_MESSAGE.Sync,
  [WS_MESSAGE.PRESENCE_UPDATE]: PRESENCE_MESSAGE.Update,
};

const ROOM_FRAME_TO_WIRE: Record<PresenceFrameKind, string> = {
  [PRESENCE_FRAME.Extension]: WS_MESSAGE.ATTENTION_STATE,
  [PRESENCE_FRAME.AuthError]: WS_MESSAGE.AUTH_ERROR,
  [PRESENCE_FRAME.AuthOk]: WS_MESSAGE.AUTH_OK,
  [PRESENCE_FRAME.Error]: WS_MESSAGE.ERROR,
  [PRESENCE_FRAME.HeartbeatAck]: WS_MESSAGE.HEARTBEAT_ACK,
  [PRESENCE_FRAME.Join]: WS_MESSAGE.JOIN,
  [PRESENCE_FRAME.Leave]: WS_MESSAGE.LEAVE,
  [PRESENCE_FRAME.SyncResponse]: WS_MESSAGE.PRESENCE_SYNC_RESPONSE,
  [PRESENCE_FRAME.Update]: WS_MESSAGE.PRESENCE_UPDATE,
};

/** Compile-time check that a wider awareness type structurally satisfies a narrower runtime one. */
const assertAssignable =
  <To>() =>
  <_From extends To>(): void =>
    undefined;

// `current`/`patch` below are cast through these; a shape drift that breaks
// either direction fails the build here instead of at a runtime cast site.
assertAssignable<PresenceMemberRecord>()<PresenceUser>();
assertAssignable<PresencePatch>()<AwarenessPresencePatch>();

/**
 * The payload-opaque `PresenceRoom` seam bound to `@softmaple/awareness`'s
 * wire protocol. Every WS_MESSAGE string, capability check, and presence
 * payload shape (cursor, selection, name, color) lives behind this file;
 * `@softmaple/collab-runtime` never imports awareness.
 */
export const awarenessPresenceCodec: PresenceCodec = {
  filterFrame: filterAttentionFrame,
  command(current, members, payload, now, context) {
    if (parseAttentionContext(context) === undefined)
      throw new Error("Shared attention is not supported.");
    const command = parseAttentionCommand(payload);
    if (!isPresenceUser(current))
      throw new Error("Presence session is unavailable.");
    const member = applyAttentionCommand(
      current,
      members.filter(isPresenceUser),
      command,
      now,
    );
    return { member, payload: { id: command.id, ok: true, member } };
  },
  applyPatch(current, patch, now) {
    const result = applyPresencePatch(
      current as unknown as PresenceUser,
      patch as unknown as AwarenessPresencePatch,
      now,
    );
    return {
      broadcastPayload: result.updates,
      member: result.member as unknown as PresenceMemberRecord,
    };
  },

  classify(envelope) {
    const kind = WIRE_TO_ROOM_MESSAGE[envelope.type];
    if (kind === undefined) {
      throw new Error(`unsupported presence wire type: ${envelope.type}`);
    }
    return kind;
  },

  consumeQuota(current, now) {
    return consumePresenceQuota(current as PresenceRateLimit | null, now);
  },

  createMember(identity, connectionId, now, context) {
    const member = createPresenceMember(identity, connectionId, now);
    const extension = parseAttentionContext(context);
    return extension === undefined
      ? member
      : {
          ...member,
          sessionId: extension.sessionId,
          collaboration: emptyCollaborationState(),
        };
  },

  encode(kind, roomId, senderId, payload) {
    const wirePayload =
      kind === PRESENCE_FRAME.Join
        ? { user: payload }
        : kind === PRESENCE_FRAME.SyncResponse
          ? { users: payload }
          : payload;
    return {
      payload: wirePayload,
      roomId,
      senderId,
      timestamp: Date.now(),
      type: ROOM_FRAME_TO_WIRE[kind],
    };
  },

  isMember(value): value is PresenceMemberRecord {
    return isPresenceUser(value);
  },

  parseAuth(payload) {
    const parsed = parsePresenceAuth(payload);
    return {
      ...(parsed.protocolContext === undefined ||
      parsed.userId.length + 1 + parsed.protocolContext.sessionId.length > 128
        ? {}
        : {
            protocolContext: {
              ...parsed.protocolContext,
              sessionId: `${parsed.userId}:${parsed.protocolContext.sessionId}`,
            },
          }),
      connectionId: parsed.connectionId,
      credential: {
        kind: "access-token",
        token: parsed.token,
      } satisfies CollabCredential,
      userId: parsed.userId,
    };
  },

  parseEnvelope(value) {
    return parsePresenceEnvelope(value);
  },

  parseHeartbeat(payload) {
    return parsePresenceHeartbeatPingId(payload);
  },

  parsePatch(payload) {
    return parsePresencePatch(payload) as unknown as PresencePatch;
  },
};
