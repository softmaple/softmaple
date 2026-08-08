import {
  parseRichTextEventBatch,
  type RichTextEventBatch,
} from "@softmaple/block-model";

export const COLLAB_PROTOCOL_VERSION = 2 as const;

export const COLLAB_MESSAGE_TYPE = {
  Auth: "auth",
  DurableAck: "durable-ack",
  Error: "error",
  Event: "event",
  Ready: "ready",
  RepairRequest: "repair-request",
  RepairResponse: "repair-response",
} as const;

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

export interface AuthMessage {
  readonly protocolVersion: typeof COLLAB_PROTOCOL_VERSION;
  readonly type: typeof COLLAB_MESSAGE_TYPE.Auth;
  readonly accessToken: string;
  readonly documentId: string;
  readonly sessionId: string;
}

export interface ClientEventMessage {
  readonly protocolVersion: typeof COLLAB_PROTOCOL_VERSION;
  readonly type: typeof COLLAB_MESSAGE_TYPE.Event;
  readonly batches: ReadonlyArray<RichTextEventBatch>;
}

export interface RepairRequestMessage {
  readonly protocolVersion: typeof COLLAB_PROTOCOL_VERSION;
  readonly type: typeof COLLAB_MESSAGE_TYPE.RepairRequest;
  readonly requestId: string;
  readonly afterCursor: string;
}

export type ClientCollabMessage =
  | AuthMessage
  | ClientEventMessage
  | RepairRequestMessage;

export interface ReadyMessage {
  readonly protocolVersion: typeof COLLAB_PROTOCOL_VERSION;
  readonly type: typeof COLLAB_MESSAGE_TYPE.Ready;
  readonly documentId: string;
  readonly userId: string;
  readonly role: CollabRole;
  readonly canWrite: boolean;
}

export interface ServerEventMessage {
  readonly protocolVersion: typeof COLLAB_PROTOCOL_VERSION;
  readonly type: typeof COLLAB_MESSAGE_TYPE.Event;
  readonly batches: ReadonlyArray<RichTextEventBatch>;
}

export interface RepairResponseMessage {
  readonly protocolVersion: typeof COLLAB_PROTOCOL_VERSION;
  readonly type: typeof COLLAB_MESSAGE_TYPE.RepairResponse;
  readonly requestId: string;
  readonly batches: ReadonlyArray<RichTextEventBatch>;
  readonly nextCursor: string;
  readonly complete: boolean;
}

export interface DurableAckMessage {
  readonly protocolVersion: typeof COLLAB_PROTOCOL_VERSION;
  readonly type: typeof COLLAB_MESSAGE_TYPE.DurableAck;
  readonly batchIds: ReadonlyArray<string>;
}

export interface CollabErrorMessage {
  readonly protocolVersion: typeof COLLAB_PROTOCOL_VERSION;
  readonly type: typeof COLLAB_MESSAGE_TYPE.Error;
  readonly code: CollabErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type ServerCollabMessage =
  | ReadyMessage
  | ServerEventMessage
  | RepairResponseMessage
  | DurableAckMessage
  | CollabErrorMessage;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const parseBatches = (value: unknown): ReadonlyArray<RichTextEventBatch> => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new Error("batches must contain between 1 and 64 event batches");
  }
  return value.map(parseRichTextEventBatch);
};

export const parseClientCollabMessage = (
  input: unknown,
): ClientCollabMessage => {
  if (!isRecord(input) || input.protocolVersion !== COLLAB_PROTOCOL_VERSION) {
    throw new Error("unsupported collaboration protocol version");
  }

  switch (input.type) {
    case COLLAB_MESSAGE_TYPE.Auth:
      if (
        !isNonEmptyString(input.accessToken) ||
        !isNonEmptyString(input.documentId) ||
        !isNonEmptyString(input.sessionId)
      ) {
        throw new Error("invalid authentication message");
      }
      return {
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Auth,
        accessToken: input.accessToken,
        documentId: input.documentId,
        sessionId: input.sessionId,
      };
    case COLLAB_MESSAGE_TYPE.Event:
      return {
        protocolVersion: COLLAB_PROTOCOL_VERSION,
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
        protocolVersion: COLLAB_PROTOCOL_VERSION,
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

export const parseServerCollabMessage = (
  input: unknown,
): ServerCollabMessage => {
  if (!isRecord(input) || input.protocolVersion !== COLLAB_PROTOCOL_VERSION) {
    throw new Error("unsupported collaboration protocol version");
  }

  switch (input.type) {
    case COLLAB_MESSAGE_TYPE.Ready:
      if (
        !isNonEmptyString(input.documentId) ||
        !isNonEmptyString(input.userId) ||
        !isCollabRole(input.role) ||
        typeof input.canWrite !== "boolean"
      ) {
        throw new Error("invalid ready message");
      }
      return {
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Ready,
        documentId: input.documentId,
        userId: input.userId,
        role: input.role,
        canWrite: input.canWrite,
      };
    case COLLAB_MESSAGE_TYPE.Event:
      return {
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Event,
        batches: parseBatches(input.batches),
      };
    case COLLAB_MESSAGE_TYPE.RepairResponse:
      if (
        !isNonEmptyString(input.requestId) ||
        typeof input.nextCursor !== "string" ||
        !/^\d+$/.test(input.nextCursor) ||
        typeof input.complete !== "boolean" ||
        !Array.isArray(input.batches)
      ) {
        throw new Error("invalid repair response");
      }
      return {
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.RepairResponse,
        requestId: input.requestId,
        batches: input.batches.map(parseRichTextEventBatch),
        nextCursor: input.nextCursor,
        complete: input.complete,
      };
    case COLLAB_MESSAGE_TYPE.DurableAck:
      if (!isStringArray(input.batchIds)) {
        throw new Error("invalid durable acknowledgement");
      }
      return {
        protocolVersion: COLLAB_PROTOCOL_VERSION,
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
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Error,
        code: input.code,
        message: input.message,
        retryable: input.retryable,
      };
    default:
      throw new Error("unsupported server message type");
  }
};
