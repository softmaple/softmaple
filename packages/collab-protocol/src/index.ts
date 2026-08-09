import {
  parseRichTextEventBatch,
  type RichTextEventBatch,
} from "@softmaple/block-model";

export const COLLAB_PROTOCOL_VERSION = 3 as const;
export const LEGACY_COLLAB_PROTOCOL_VERSION = 2 as const;
export type SupportedCollabProtocolVersion =
  | typeof COLLAB_PROTOCOL_VERSION
  | typeof LEGACY_COLLAB_PROTOCOL_VERSION;

export const COLLAB_MESSAGE_TYPE = {
  Auth: "auth",
  DurableAck: "durable-ack",
  Error: "error",
  Event: "event",
  Ready: "ready",
  RepairRequest: "repair-request",
  RepairResponse: "repair-response",
} as const;

export const COLLAB_ACCESS_MODE = {
  Authenticated: "authenticated",
  Public: "public",
} as const;

export type CollabAccessMode =
  (typeof COLLAB_ACCESS_MODE)[keyof typeof COLLAB_ACCESS_MODE];

export const COLLAB_ERROR_CODE = {
  AuthenticationFailed: "authentication-failed",
  Conflict: "conflict",
  Forbidden: "forbidden",
  InvalidMessage: "invalid-message",
  PersistenceFailed: "persistence-failed",
} as const;

export type CollabErrorCode =
  (typeof COLLAB_ERROR_CODE)[keyof typeof COLLAB_ERROR_CODE];
export type CollabRole = "OWNER" | "EDITOR" | "VIEWER";

export type AccessTokenCredential = {
  readonly kind: "access-token";
  readonly token: string;
};
export type PublicCredential = { readonly kind: "public" };
export type CollabCredential = AccessTokenCredential | PublicCredential;

export interface AuthMessage {
  readonly protocolVersion: typeof COLLAB_PROTOCOL_VERSION;
  readonly type: typeof COLLAB_MESSAGE_TYPE.Auth;
  readonly credential: CollabCredential;
  readonly documentId: string;
  readonly sessionId: string;
}

export interface LegacyAuthMessage {
  readonly protocolVersion: typeof LEGACY_COLLAB_PROTOCOL_VERSION;
  readonly type: typeof COLLAB_MESSAGE_TYPE.Auth;
  readonly accessToken: string;
  readonly documentId: string;
  readonly sessionId: string;
}

export interface ClientEventMessage {
  readonly protocolVersion: SupportedCollabProtocolVersion;
  readonly type: typeof COLLAB_MESSAGE_TYPE.Event;
  readonly batches: ReadonlyArray<RichTextEventBatch>;
}

export interface RepairRequestMessage {
  readonly protocolVersion: SupportedCollabProtocolVersion;
  readonly type: typeof COLLAB_MESSAGE_TYPE.RepairRequest;
  readonly requestId: string;
  readonly afterCursor: string;
}

export type ClientCollabMessage =
  | AuthMessage
  | LegacyAuthMessage
  | ClientEventMessage
  | RepairRequestMessage;

export interface ReadyMessage {
  readonly protocolVersion: typeof COLLAB_PROTOCOL_VERSION;
  readonly type: typeof COLLAB_MESSAGE_TYPE.Ready;
  readonly accessMode: CollabAccessMode;
  readonly documentId: string;
  readonly userId: string | null;
  readonly role: CollabRole | null;
  readonly canWrite: boolean;
}

export interface LegacyReadyMessage {
  readonly protocolVersion: typeof LEGACY_COLLAB_PROTOCOL_VERSION;
  readonly type: typeof COLLAB_MESSAGE_TYPE.Ready;
  readonly documentId: string;
  readonly userId: string;
  readonly role: CollabRole;
  readonly canWrite: boolean;
}

export interface ServerEventMessage {
  readonly protocolVersion: SupportedCollabProtocolVersion;
  readonly type: typeof COLLAB_MESSAGE_TYPE.Event;
  readonly batches: ReadonlyArray<RichTextEventBatch>;
}

export interface RepairResponseMessage {
  readonly protocolVersion: SupportedCollabProtocolVersion;
  readonly type: typeof COLLAB_MESSAGE_TYPE.RepairResponse;
  readonly requestId: string;
  readonly batches: ReadonlyArray<RichTextEventBatch>;
  readonly nextCursor: string;
  readonly complete: boolean;
}

export interface DurableAckMessage {
  readonly protocolVersion: SupportedCollabProtocolVersion;
  readonly type: typeof COLLAB_MESSAGE_TYPE.DurableAck;
  readonly batchIds: ReadonlyArray<string>;
}

export interface CollabErrorMessage {
  readonly protocolVersion: SupportedCollabProtocolVersion;
  readonly type: typeof COLLAB_MESSAGE_TYPE.Error;
  readonly code: CollabErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type ServerCollabMessage =
  | ReadyMessage
  | LegacyReadyMessage
  | ServerEventMessage
  | RepairResponseMessage
  | DurableAckMessage
  | CollabErrorMessage;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const isSupportedVersion = (
  value: unknown,
): value is SupportedCollabProtocolVersion =>
  value === COLLAB_PROTOCOL_VERSION || value === LEGACY_COLLAB_PROTOCOL_VERSION;

const parseBatches = (value: unknown): ReadonlyArray<RichTextEventBatch> => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new Error("batches must contain between 1 and 64 event batches");
  }
  return value.map(parseRichTextEventBatch);
};

const parseRepairPage = (value: unknown): ReadonlyArray<RichTextEventBatch> => {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("repair batches must contain between 0 and 100 batches");
  }
  return value.map(parseRichTextEventBatch);
};

const parseCredential = (value: unknown): CollabCredential => {
  if (!isRecord(value) || !isNonEmptyString(value.kind)) {
    throw new Error("invalid collaboration credential");
  }
  if (value.kind === "public") return { kind: "public" };
  if (value.kind === "access-token" && isNonEmptyString(value.token)) {
    return { kind: "access-token", token: value.token };
  }
  throw new Error("invalid collaboration credential");
};

export const parseClientCollabMessage = (
  input: unknown,
): ClientCollabMessage => {
  if (!isRecord(input) || !isSupportedVersion(input.protocolVersion)) {
    throw new Error("unsupported collaboration protocol version");
  }
  const protocolVersion = input.protocolVersion;

  switch (input.type) {
    case COLLAB_MESSAGE_TYPE.Auth:
      if (
        !isNonEmptyString(input.documentId) ||
        !isNonEmptyString(input.sessionId)
      ) {
        throw new Error("invalid authentication message");
      }
      if (protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION) {
        if (!isNonEmptyString(input.accessToken)) {
          throw new Error("invalid legacy authentication message");
        }
        return {
          protocolVersion,
          type: COLLAB_MESSAGE_TYPE.Auth,
          accessToken: input.accessToken,
          documentId: input.documentId,
          sessionId: input.sessionId,
        };
      }
      return {
        protocolVersion,
        type: COLLAB_MESSAGE_TYPE.Auth,
        credential: parseCredential(input.credential),
        documentId: input.documentId,
        sessionId: input.sessionId,
      };
    case COLLAB_MESSAGE_TYPE.Event:
      return {
        protocolVersion,
        type: COLLAB_MESSAGE_TYPE.Event,
        batches: parseBatches(input.batches),
      };
    case COLLAB_MESSAGE_TYPE.RepairRequest:
      if (
        !isNonEmptyString(input.requestId) ||
        typeof input.afterCursor !== "string" ||
        !/^\d+$/.test(input.afterCursor)
      ) {
        throw new Error("invalid repair request");
      }
      return {
        protocolVersion,
        type: COLLAB_MESSAGE_TYPE.RepairRequest,
        requestId: input.requestId,
        afterCursor: input.afterCursor,
      };
    default:
      throw new Error("unsupported client message type");
  }
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isNonEmptyString);
const isCollabRole = (value: unknown): value is CollabRole =>
  value === "OWNER" || value === "EDITOR" || value === "VIEWER";
const isErrorCode = (value: unknown): value is CollabErrorCode =>
  Object.values(COLLAB_ERROR_CODE).some((code) => code === value);
const isAccessMode = (value: unknown): value is CollabAccessMode =>
  Object.values(COLLAB_ACCESS_MODE).some((mode) => mode === value);

export const parseServerCollabMessage = (
  input: unknown,
): ServerCollabMessage => {
  if (!isRecord(input) || !isSupportedVersion(input.protocolVersion)) {
    throw new Error("unsupported collaboration protocol version");
  }
  const protocolVersion = input.protocolVersion;

  switch (input.type) {
    case COLLAB_MESSAGE_TYPE.Ready:
      if (
        !isNonEmptyString(input.documentId) ||
        typeof input.canWrite !== "boolean"
      ) {
        throw new Error("invalid ready message");
      }
      if (protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION) {
        if (!isNonEmptyString(input.userId) || !isCollabRole(input.role)) {
          throw new Error("invalid legacy ready message");
        }
        return {
          protocolVersion,
          type: COLLAB_MESSAGE_TYPE.Ready,
          documentId: input.documentId,
          userId: input.userId,
          role: input.role,
          canWrite: input.canWrite,
        };
      }
      if (
        !isAccessMode(input.accessMode) ||
        !(input.userId === null || isNonEmptyString(input.userId)) ||
        !(input.role === null || isCollabRole(input.role)) ||
        (input.accessMode === COLLAB_ACCESS_MODE.Public &&
          (input.userId !== null || input.role !== null || input.canWrite))
      ) {
        throw new Error("invalid ready message");
      }
      return {
        protocolVersion,
        type: COLLAB_MESSAGE_TYPE.Ready,
        accessMode: input.accessMode,
        documentId: input.documentId,
        userId: input.userId,
        role: input.role,
        canWrite: input.canWrite,
      };
    case COLLAB_MESSAGE_TYPE.Event:
      return {
        protocolVersion,
        type: COLLAB_MESSAGE_TYPE.Event,
        batches: parseBatches(input.batches),
      };
    case COLLAB_MESSAGE_TYPE.RepairResponse:
      if (
        !isNonEmptyString(input.requestId) ||
        typeof input.nextCursor !== "string" ||
        !/^\d+$/.test(input.nextCursor) ||
        typeof input.complete !== "boolean"
      ) {
        throw new Error("invalid repair response");
      }
      return {
        protocolVersion,
        type: COLLAB_MESSAGE_TYPE.RepairResponse,
        requestId: input.requestId,
        batches: parseRepairPage(input.batches),
        nextCursor: input.nextCursor,
        complete: input.complete,
      };
    case COLLAB_MESSAGE_TYPE.DurableAck:
      if (!isStringArray(input.batchIds)) {
        throw new Error("invalid durable acknowledgement");
      }
      return {
        protocolVersion,
        type: COLLAB_MESSAGE_TYPE.DurableAck,
        batchIds: input.batchIds,
      };
    case COLLAB_MESSAGE_TYPE.Error:
      if (
        !isErrorCode(input.code) ||
        !isNonEmptyString(input.message) ||
        typeof input.retryable !== "boolean"
      ) {
        throw new Error("invalid collaboration error");
      }
      return {
        protocolVersion,
        type: COLLAB_MESSAGE_TYPE.Error,
        code: input.code,
        message: input.message,
        retryable: input.retryable,
      };
    default:
      throw new Error("unsupported server message type");
  }
};
