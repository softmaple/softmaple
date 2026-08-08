import { z } from "zod";
import { WireBatchSchema } from "./batch";
import { CollabErrorCode } from "./errors";

export const COLLAB_PROTOCOL_VERSION = 2 as const;

export const CollabMessageType = {
  Auth: "auth",
  AuthOk: "auth-ok",
  Reauth: "reauth",
  Event: "event",
  RepairRequest: "repair-request",
  RepairResponse: "repair-response",
  DurableAck: "durable-ack",
  Error: "error",
} as const;

export type CollabMessageType =
  (typeof CollabMessageType)[keyof typeof CollabMessageType];

export const WorkspaceRole = {
  Owner: "OWNER",
  Editor: "EDITOR",
  Viewer: "VIEWER",
} as const;

export type WorkspaceRole = (typeof WorkspaceRole)[keyof typeof WorkspaceRole];

const DocumentIdSchema = z.string().uuid();
const ReplicaIdSchema = z.string().trim().min(1);
const AccessTokenSchema = z.string().trim().min(1);
const CursorSchema = z
  .string()
  .regex(/^\d+$/, "cursor must be a non-negative integer string");

const MessageBaseSchema = z.object({
  protocolVersion: z.literal(COLLAB_PROTOCOL_VERSION),
});

export const AuthMessageSchema = MessageBaseSchema.extend({
  type: z.literal(CollabMessageType.Auth),
  accessToken: AccessTokenSchema,
  documentId: DocumentIdSchema,
  replicaId: ReplicaIdSchema,
}).strict();

export const ReauthMessageSchema = MessageBaseSchema.extend({
  type: z.literal(CollabMessageType.Reauth),
  accessToken: AccessTokenSchema,
}).strict();

export const EventMessageSchema = MessageBaseSchema.extend({
  type: z.literal(CollabMessageType.Event),
  documentId: DocumentIdSchema,
  senderId: ReplicaIdSchema,
  batch: WireBatchSchema,
}).strict();

export const RepairRequestMessageSchema = MessageBaseSchema.extend({
  type: z.literal(CollabMessageType.RepairRequest),
  documentId: DocumentIdSchema,
  senderId: ReplicaIdSchema,
  requestId: z.string().trim().min(1),
  afterCursor: CursorSchema.nullable().optional(),
  limit: z.number().int().positive().max(500).optional(),
}).strict();

export const RepairBatchEnvelopeSchema = z
  .object({
    cursor: CursorSchema,
    batch: WireBatchSchema,
  })
  .strict();

export const RepairResponseMessageSchema = MessageBaseSchema.extend({
  type: z.literal(CollabMessageType.RepairResponse),
  documentId: DocumentIdSchema,
  senderId: z.literal("server"),
  requestId: z.string().trim().min(1),
  recipientId: ReplicaIdSchema,
  batches: z.array(RepairBatchEnvelopeSchema),
  nextCursor: CursorSchema.nullable(),
  hasMore: z.boolean(),
}).strict();

/** Server-only acknowledgment that batches are durable in Postgres. */
export const DurableAckMessageSchema = MessageBaseSchema.extend({
  type: z.literal(CollabMessageType.DurableAck),
  documentId: DocumentIdSchema,
  senderId: z.literal("server"),
  batchIds: z.array(z.string().trim().min(1)).min(1),
  cursors: z.record(z.string(), CursorSchema).optional(),
}).strict();

export const AuthOkMessageSchema = MessageBaseSchema.extend({
  type: z.literal(CollabMessageType.AuthOk),
  documentId: DocumentIdSchema,
  senderId: z.literal("server"),
  userId: z.string().uuid(),
  role: z.enum([
    WorkspaceRole.Owner,
    WorkspaceRole.Editor,
    WorkspaceRole.Viewer,
  ]),
  canWrite: z.boolean(),
}).strict();

export const ErrorMessageSchema = MessageBaseSchema.extend({
  type: z.literal(CollabMessageType.Error),
  documentId: DocumentIdSchema.optional(),
  senderId: z.literal("server"),
  code: z.enum([
    CollabErrorCode.Unauthorized,
    CollabErrorCode.Forbidden,
    CollabErrorCode.InvalidMessage,
    CollabErrorCode.InvalidBatch,
    CollabErrorCode.BatchConflict,
    CollabErrorCode.EventIdConflict,
    CollabErrorCode.UnknownParent,
    CollabErrorCode.ReadOnly,
    CollabErrorCode.NotAuthenticated,
    CollabErrorCode.PersistenceFailed,
    CollabErrorCode.Internal,
  ]),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const ClientCollabMessageSchema = z.discriminatedUnion("type", [
  AuthMessageSchema,
  ReauthMessageSchema,
  EventMessageSchema,
  RepairRequestMessageSchema,
]);

export const ServerCollabMessageSchema = z.discriminatedUnion("type", [
  AuthOkMessageSchema,
  EventMessageSchema,
  RepairResponseMessageSchema,
  DurableAckMessageSchema,
  ErrorMessageSchema,
]);

export const CollabMessageSchema = z.discriminatedUnion("type", [
  AuthMessageSchema,
  AuthOkMessageSchema,
  ReauthMessageSchema,
  EventMessageSchema,
  RepairRequestMessageSchema,
  RepairResponseMessageSchema,
  DurableAckMessageSchema,
  ErrorMessageSchema,
]);

export type AuthMessage = z.infer<typeof AuthMessageSchema>;
export type AuthOkMessage = z.infer<typeof AuthOkMessageSchema>;
export type ReauthMessage = z.infer<typeof ReauthMessageSchema>;
export type EventMessage = z.infer<typeof EventMessageSchema>;
export type RepairRequestMessage = z.infer<typeof RepairRequestMessageSchema>;
export type RepairResponseMessage = z.infer<typeof RepairResponseMessageSchema>;
export type DurableAckMessage = z.infer<typeof DurableAckMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type ClientCollabMessage = z.infer<typeof ClientCollabMessageSchema>;
export type ServerCollabMessage = z.infer<typeof ServerCollabMessageSchema>;
export type CollabMessage = z.infer<typeof CollabMessageSchema>;

export const DEFAULT_REPAIR_PAGE_SIZE = 100;
export const MAX_REPAIR_PAGE_SIZE = 500;

export const canWriteRole = (role: WorkspaceRole): boolean =>
  role === WorkspaceRole.Owner || role === WorkspaceRole.Editor;
