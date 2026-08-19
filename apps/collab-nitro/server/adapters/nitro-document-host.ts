import {
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  parseClientCollabMessage,
  type AuthMessage,
  type ClientCollabMessage,
  type CollabErrorCode,
  type LegacyAuthMessage,
  type ServerCollabMessage,
  type SupportedCollabProtocolVersion,
} from "@softmaple/collab-protocol";
import {
  createDocumentRoom,
  DEFAULT_DOCUMENT_ROOM_POLICY,
  DocumentEventConflictError,
  type DocumentRoom,
  type DocumentRoomMetricEvent,
  type DocumentRoomServices,
  ROOM_LEAVE_REASON,
  type RoomLeaveReason,
  type RoomPeer,
} from "@softmaple/collab-runtime";
import { randomUUID } from "node:crypto";
import { documentSessionHooks } from "./document-session-hooks";
import { prismaDocumentEventStore } from "./prisma-document-event-store";
import { realtimeConnectionLimiter } from "./realtime-connection-limiter";
import { realtimeRoomFanout } from "./realtime-room-fanout";

const MESSAGE_RATE_LIMIT_WINDOW_MS = 10_000;
export const MESSAGE_RATE_LIMIT_MAX = 120;
export const MAX_MESSAGE_BYTES = 256 * 1024;
const DOCUMENT_HOST_CONTEXT_KEY = "documentRuntimeHost";

interface MessageRateLimit {
  readonly count: number;
  readonly windowStartedAt: number;
}

export interface NitroDocumentTransportPeer {
  readonly context: Record<string, unknown>;
  readonly id?: string;
  close(code: number, reason: string): void;
  send(message: unknown): unknown;
}

export const logDocumentMetric = (event: DocumentRoomMetricEvent): void => {
  console.log("Collaboration metric", event);
};

const roomServices: DocumentRoomServices = {
  connections: realtimeConnectionLimiter,
  events: prismaDocumentEventStore,
  fanout: realtimeRoomFanout,
  metrics: logDocumentMetric,
  policy: DEFAULT_DOCUMENT_ROOM_POLICY,
  reportError(error, context) {
    logHostError(error, context.documentId, context.messageType);
  },
  sessions: documentSessionHooks,
};

const errorMessage = (
  code: CollabErrorCode,
  message: string,
  retryable: boolean,
  protocolVersion: SupportedCollabProtocolVersion = COLLAB_PROTOCOL_VERSION,
): ServerCollabMessage => ({
  protocolVersion,
  type: COLLAB_MESSAGE_TYPE.Error,
  code,
  message,
  retryable,
});

const logHostError = (
  error: unknown,
  documentId: string | null,
  messageType: string,
): void => {
  const boundedIds = (ids: ReadonlyArray<string> | undefined) =>
    ids === undefined
      ? undefined
      : { count: ids.length, sample: ids.slice(0, 8) };
  console.error("Collaboration request failed", {
    documentId,
    messageType,
    errorName:
      error instanceof DocumentEventConflictError
        ? "EventConflictError"
        : error instanceof Error
          ? error.name
          : "UnknownError",
    errorMessage: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...(error instanceof DocumentEventConflictError
      ? {
          conflictType: error.details.conflictType,
          batchIds: boundedIds(error.details.batchIds),
          eventIds: boundedIds(error.details.eventIds),
          missingParentIds: boundedIds(error.details.missingParentIds),
        }
      : {}),
  });
};

const consumeMessageQuota = (context: Record<string, unknown>): boolean => {
  const now = Date.now();
  const stored = context.messageRateLimit;
  const current =
    typeof stored === "object" &&
    stored !== null &&
    typeof (stored as Partial<MessageRateLimit>).count === "number" &&
    typeof (stored as Partial<MessageRateLimit>).windowStartedAt === "number"
      ? (stored as MessageRateLimit)
      : null;
  if (
    current === null ||
    now - current.windowStartedAt >= MESSAGE_RATE_LIMIT_WINDOW_MS
  ) {
    context.messageRateLimit = { count: 1, windowStartedAt: now };
    return true;
  }
  if (current.count >= MESSAGE_RATE_LIMIT_MAX) return false;
  context.messageRateLimit = { ...current, count: current.count + 1 };
  return true;
};

class NitroRoomPeer implements RoomPeer {
  readonly id: string;
  private closeRequested = false;
  private readyDocumentId: string | null = null;
  private sessionProtocolVersion: SupportedCollabProtocolVersion =
    COLLAB_PROTOCOL_VERSION;

  constructor(private readonly transport: NitroDocumentTransportPeer) {
    this.id =
      typeof transport.id === "string" && transport.id.length > 0
        ? transport.id
        : randomUUID();
  }

  get closed(): boolean {
    return this.closeRequested;
  }

  get protocolVersion(): SupportedCollabProtocolVersion {
    return this.sessionProtocolVersion;
  }

  observedReady(documentId: string): boolean {
    return this.readyDocumentId === documentId;
  }

  close(code: number, reason: string): void {
    if (this.closeRequested) return;
    this.closeRequested = true;
    this.transport.close(code, reason);
  }

  markTransportClosed(): void {
    this.closeRequested = true;
  }

  send(message: ServerCollabMessage): void {
    if (this.closeRequested) return;
    this.transport.send(message);
    if (message.type === COLLAB_MESSAGE_TYPE.Ready) {
      this.readyDocumentId = message.documentId;
      this.sessionProtocolVersion = message.protocolVersion;
    }
  }
}

interface RoomEntry {
  readonly peers: Set<NitroRoomPeer>;
  readonly room: DocumentRoom;
}

interface RoomBinding {
  readonly documentId: string;
  readonly room: DocumentRoom;
  release(reason?: RoomLeaveReason): Promise<void>;
}

const rooms = new Map<string, RoomEntry>();

const normalizeDocumentId = (documentId: string): string => {
  const unwrapped =
    documentId.startsWith("{") && documentId.endsWith("}")
      ? documentId.slice(1, -1)
      : documentId;
  if (!/^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/i.test(unwrapped)) {
    return documentId;
  }
  const compact = unwrapped.replaceAll("-", "");
  if (compact.length !== 32) return documentId;
  const normalized = compact.toLowerCase();
  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20),
  ].join("-");
};

const closeRoomEntry = async (
  documentId: string,
  entry: RoomEntry,
): Promise<void> => {
  if (rooms.get(documentId) !== entry || entry.peers.size > 0) return;
  rooms.delete(documentId);
  try {
    await entry.room.close();
  } catch (error) {
    logHostError(error, documentId, "room-close");
  }
};

const acquireRoom = async (
  documentId: string,
  peer: NitroRoomPeer,
): Promise<RoomBinding> => {
  const entry =
    rooms.get(documentId) ??
    (() => {
      const created: RoomEntry = {
        peers: new Set<NitroRoomPeer>(),
        room: createDocumentRoom(documentId, roomServices),
      };
      rooms.set(documentId, created);
      return created;
    })();
  entry.peers.add(peer);
  try {
    await entry.room.join(peer);
  } catch (error) {
    entry.peers.delete(peer);
    await closeRoomEntry(documentId, entry);
    throw error;
  }

  let released = false;
  return {
    documentId,
    room: entry.room,
    async release(reason = ROOM_LEAVE_REASON.ConnectionClosed) {
      if (released) return;
      released = true;
      try {
        await entry.room.leave(peer, reason);
      } catch (error) {
        logHostError(error, documentId, "room-leave");
      } finally {
        entry.peers.delete(peer);
        await closeRoomEntry(documentId, entry);
      }
    },
  };
};

/** Per-socket ingress and room binding around a Nitro/crossws peer. */
export class NitroDocumentHost {
  private readonly peer: NitroRoomPeer;
  private activeRoom: RoomBinding | null = null;
  private pendingRoom: RoomBinding | null = null;
  private closed = false;

  constructor(private readonly transport: NitroDocumentTransportPeer) {
    this.peer = new NitroRoomPeer(transport);
  }

  async receiveText(rawText: string): Promise<void> {
    if (this.closed || this.peer.closed) return;
    if (Buffer.byteLength(rawText, "utf8") > MAX_MESSAGE_BYTES) {
      this.peer.close(1009, "Collaboration message is too large");
      await this.releaseRooms();
      return;
    }
    if (!consumeMessageQuota(this.transport.context)) {
      this.peer.send(
        errorMessage(
          COLLAB_ERROR_CODE.InvalidMessage,
          "Too many collaboration messages",
          true,
          this.protocolVersion(),
        ),
      );
      this.peer.close(1013, "Message rate limit exceeded");
      await this.releaseRooms();
      return;
    }

    let message: ClientCollabMessage;
    try {
      message = parseClientCollabMessage(JSON.parse(rawText));
    } catch (error) {
      logHostError(error, this.activeRoom?.documentId ?? null, "unknown");
      this.peer.send(
        errorMessage(
          COLLAB_ERROR_CODE.InvalidMessage,
          "The collaboration message is invalid",
          false,
          this.protocolVersion(),
        ),
      );
      return;
    }

    if (message.type === COLLAB_MESSAGE_TYPE.Auth) {
      await this.receiveAuth(message);
      return;
    }
    if (this.activeRoom === null) {
      this.peer.send(
        errorMessage(
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "Authenticate before sending collaboration messages",
          false,
          this.protocolVersion(),
        ),
      );
      return;
    }

    await this.activeRoom.room.receive(this.peer, message);
    if (this.peer.closed) await this.releaseRooms();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.peer.markTransportClosed();
    delete this.transport.context.authenticationPending;
    await this.releaseRooms();
  }

  private async receiveAuth(
    message: AuthMessage | LegacyAuthMessage,
  ): Promise<void> {
    if (this.activeRoom !== null) {
      await this.activeRoom.room.receive(this.peer, message);
      if (this.peer.closed) await this.releaseRooms();
      return;
    }
    if (this.transport.context.authenticationPending === true) {
      this.peer.close(1008, "Authentication already in progress");
      // Mark the in-flight room state as leaving without making this second
      // Auth wait for the provider call that it is interrupting.
      const documentId = this.pendingRoom?.documentId ?? null;
      void this.releaseRooms().catch((error: unknown) => {
        logHostError(error, documentId, "room-release");
      });
      return;
    }

    this.transport.context.authenticationPending = true;
    let binding: RoomBinding | null = null;
    const normalizedDocumentId = normalizeDocumentId(message.documentId);
    const normalizedMessage = { ...message, documentId: normalizedDocumentId };
    try {
      binding = await acquireRoom(normalizedDocumentId, this.peer);
      this.pendingRoom = binding;
      if (this.closed || this.peer.closed) return;
      await binding.room.receive(this.peer, normalizedMessage);
      if (
        !this.closed &&
        !this.peer.closed &&
        this.peer.observedReady(normalizedDocumentId)
      ) {
        this.activeRoom = binding;
        this.pendingRoom = null;
        return;
      }
    } catch (error) {
      logHostError(error, normalizedDocumentId, message.type);
      if (!this.closed && !this.peer.closed) {
        this.peer.send(
          errorMessage(
            COLLAB_ERROR_CODE.AuthenticationFailed,
            "Authentication is temporarily unavailable",
            true,
            message.protocolVersion,
          ),
        );
      }
    } finally {
      if (this.activeRoom !== binding) {
        this.pendingRoom = null;
        await binding?.release();
      }
      delete this.transport.context.authenticationPending;
    }
  }

  private protocolVersion(): SupportedCollabProtocolVersion {
    return this.peer.protocolVersion;
  }

  private async releaseRooms(): Promise<void> {
    const bindings = new Set(
      [this.pendingRoom, this.activeRoom].filter(
        (binding): binding is RoomBinding => binding !== null,
      ),
    );
    this.pendingRoom = null;
    this.activeRoom = null;
    await Promise.all([...bindings].map((binding) => binding.release()));
  }
}

const hostFromContext = (
  context: Record<string, unknown>,
): NitroDocumentHost | null => {
  const value = context[DOCUMENT_HOST_CONTEXT_KEY];
  return value instanceof NitroDocumentHost ? value : null;
};

export const getNitroDocumentHost = (
  peer: NitroDocumentTransportPeer,
): NitroDocumentHost => {
  const existing = hostFromContext(peer.context);
  if (existing !== null) return existing;
  const host = new NitroDocumentHost(peer);
  peer.context[DOCUMENT_HOST_CONTEXT_KEY] = host;
  return host;
};

export const closeNitroDocumentHost = async (
  peer: NitroDocumentTransportPeer,
): Promise<void> => {
  const host = hostFromContext(peer.context);
  delete peer.context[DOCUMENT_HOST_CONTEXT_KEY];
  await host?.close();
};
