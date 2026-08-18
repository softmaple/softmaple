import { DurableObject } from "cloudflare:workers";
import {
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  parseClientCollabMessage,
  type AuthMessage,
  type ClientCollabMessage,
  type LegacyAuthMessage,
  type LegacyReadyMessage,
  type ReadyMessage,
  type ServerCollabMessage,
} from "@softmaple/collab-protocol";
import {
  createDocumentRoom,
  DOCUMENT_ROOM_REFRESH_MODE,
  type DocumentRoom,
  type DocumentRoomResumeState,
  type DocumentRoomServices,
  type RoomPeer,
} from "@softmaple/collab-runtime";
import {
  authDeadlineFrom,
  AUTH_DEADLINE_CLOSE_CODE,
  AUTH_DEADLINE_CLOSE_REASON,
  collectPendingAuthSockets,
  earliestAuthDeadline,
  planAuthDeadlineSweep,
  scheduleAlarmAt,
  type PendingAuthSocket,
} from "./auth-deadline";
import {
  errorMessage,
  logError,
  logMetric,
  MAX_MESSAGE_BYTES,
  MAX_PERSISTED_AUTH_BYTES,
  MESSAGE_RATE_LIMIT_MAX,
  MESSAGE_RATE_LIMIT_WINDOW_MS,
} from "./constants";
import { documentIdFromRequestUrl, normalizeDocumentId } from "./document-id";
import { messageBytes, textFromMessage } from "./message-bytes";
import { createRoomServices } from "./room-services";
import { completeClose } from "./websocket-close";
import {
  attachmentAfterReady,
  attachmentAfterResume,
  attachmentWithQuota,
  createAwaitingAuthAttachment,
  parseDocumentWebSocketAttachment,
  protocolVersionFromAttachment,
  resumeStateFromAttachment,
  type DocumentWebSocketAttachment,
} from "./websocket-attachment";

class DurableObjectRoomPeer implements RoomPeer {
  readonly id: string;

  private attachment: DocumentWebSocketAttachment;
  private cleanedUp = false;
  private closeRequested = false;
  private messageCount: number;
  private messageQueue: Promise<void> = Promise.resolve();
  private pendingAuth: AuthMessage | LegacyAuthMessage | null = null;
  private windowStartedAt: number;

  constructor(
    private readonly room: DocumentRoom,
    private readonly socket: WebSocket,
    attachment: DocumentWebSocketAttachment,
  ) {
    this.attachment = attachment;
    this.id = attachment.peerId;
    this.messageCount = attachment.quota.count;
    this.windowStartedAt = attachment.quota.windowStartedAt;
  }

  get active(): boolean {
    return !this.cleanedUp && !this.closeRequested;
  }

  get documentId(): string {
    return this.attachment.documentId;
  }

  ownsSocket(socket: WebSocket): boolean {
    return this.socket === socket;
  }

  dispatch(rawMessage: string | ArrayBuffer): Promise<void> {
    return this.enqueue(async () => {
      await this.receive(rawMessage);
    });
  }

  resume(state: DocumentRoomResumeState): Promise<void> {
    return this.enqueue(async () => {
      if (
        this.cleanedUp ||
        this.closeRequested ||
        this.attachment.phase !== "authenticated"
      ) {
        return;
      }
      const session = await this.room.resume(this, state);
      if (session === null) {
        this.cleanedUp = true;
        this.closeRequested = true;
        return;
      }
      if (this.closeRequested) {
        await this.cleanupNow();
        return;
      }
      const attachment = attachmentAfterResume(
        this.attachment,
        session,
        Date.now(),
      );
      if (attachment === null) {
        throw new Error("Resumed collaboration session metadata is invalid");
      }
      this.replaceAttachment(attachment);
    });
  }

  transportClosed(): Promise<void> {
    this.closeRequested = true;
    return this.enqueue(async () => {
      await this.cleanupNow();
    });
  }

  transportError(error: unknown): Promise<void> {
    logError(error, {
      documentId: this.documentId,
      messageType: "websocket-error",
      peerId: this.id,
    });
    this.close(1011, "Collaboration transport failure");
    return this.enqueue(async () => {
      await this.cleanupNow();
    });
  }

  fail(error: unknown, messageType: string): Promise<void> {
    return this.enqueue(async () => {
      await this.handleFailure(error, messageType);
    });
  }

  close(code: number, reason: string): void {
    if (this.closeRequested) return;
    this.closeRequested = true;
    if (this.socket.readyState < WebSocket.CLOSING) {
      this.socket.close(code, reason);
    }
  }

  send(message: ServerCollabMessage): void {
    if (this.closeRequested || this.socket.readyState !== WebSocket.OPEN) {
      if (message.type === COLLAB_MESSAGE_TYPE.Ready) {
        throw new Error(
          "Collaboration socket closed before authentication completed",
        );
      }
      return;
    }
    const previousAttachment = this.attachment;
    if (message.type === COLLAB_MESSAGE_TYPE.Ready) {
      this.persistReady(message);
    }
    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      if (message.type === COLLAB_MESSAGE_TYPE.Ready) {
        try {
          this.replaceAttachment(previousAttachment);
        } catch (rollbackError) {
          logError(rollbackError, {
            documentId: this.documentId,
            messageType: "websocket-ready-rollback",
            peerId: this.id,
          });
          this.close(1011, "Collaboration runtime failure");
        }
      }
      throw error;
    }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const queued = this.messageQueue.then(operation, operation);
    const guarded = queued.catch(async (error: unknown) => {
      await this.handleFailure(error, "websocket");
    });
    this.messageQueue = guarded;
    return guarded;
  }

  private async handleFailure(
    error: unknown,
    messageType: string,
  ): Promise<void> {
    logError(error, {
      documentId: this.documentId,
      messageType,
      peerId: this.id,
    });
    this.close(1011, "Collaboration runtime failure");
    try {
      await this.cleanupNow();
    } catch (cleanupError) {
      logError(cleanupError, {
        documentId: this.documentId,
        messageType: "websocket-cleanup",
        peerId: this.id,
      });
    }
  }

  private consumeQuota(): boolean {
    const now = Date.now();
    if (now - this.windowStartedAt >= MESSAGE_RATE_LIMIT_WINDOW_MS) {
      this.messageCount = 1;
      this.windowStartedAt = now;
      this.replaceAttachment(
        attachmentWithQuota(this.attachment, {
          count: 1,
          windowStartedAt: now,
        }),
      );
      return true;
    }
    if (this.messageCount >= MESSAGE_RATE_LIMIT_MAX) return false;
    this.messageCount += 1;
    return true;
  }

  private async receive(rawMessage: string | ArrayBuffer): Promise<void> {
    if (this.cleanedUp || this.closeRequested) return;
    if (messageBytes(rawMessage) > MAX_MESSAGE_BYTES) {
      this.close(1009, "Collaboration message is too large");
      await this.cleanupNow();
      return;
    }
    if (!this.consumeQuota()) {
      this.send(
        errorMessage(
          COLLAB_ERROR_CODE.InvalidMessage,
          "Too many collaboration messages",
          true,
          protocolVersionFromAttachment(this.attachment),
        ),
      );
      this.close(1013, "Message rate limit exceeded");
      await this.cleanupNow();
      return;
    }

    let message: ClientCollabMessage;
    try {
      message = parseClientCollabMessage(
        JSON.parse(textFromMessage(rawMessage)),
      );
    } catch (error) {
      logError(error, {
        documentId: this.documentId,
        messageType: "invalid-message",
        peerId: this.id,
      });
      this.send(
        errorMessage(
          COLLAB_ERROR_CODE.InvalidMessage,
          "The collaboration message is invalid",
          false,
          protocolVersionFromAttachment(this.attachment),
        ),
      );
      return;
    }

    if (message.type === COLLAB_MESSAGE_TYPE.Auth) {
      const auth = this.authForRoutedDocument(message);
      if (auth === null) {
        this.send(
          errorMessage(
            COLLAB_ERROR_CODE.AuthenticationFailed,
            "Authentication or document membership failed",
            false,
            message.protocolVersion,
          ),
        );
        this.close(1008, "Unauthorized");
        await this.cleanupNow();
        return;
      }
      if (messageBytes(JSON.stringify(auth)) > MAX_PERSISTED_AUTH_BYTES) {
        this.close(1009, "Authentication metadata is too large");
        await this.cleanupNow();
        return;
      }
      message = auth;
      this.pendingAuth = auth;
    }
    try {
      await this.room.receive(this, message);
    } finally {
      this.pendingAuth = null;
    }
    if (this.closeRequested) await this.cleanupNow();
  }

  /**
   * Binds an `Auth` message to the document this socket was routed to. The
   * `?documentId=` the Worker resolved the Durable Object with is the room's
   * identity, so authenticating against any other document must be rejected
   * before the authorization hook runs — a client must not be able to open
   * document A's object and authorize against document B. Normalizing first
   * preserves the pre-routing wire contract (any UUID spelling is accepted)
   * and keeps the room, session, and attachment on the canonical id, which
   * `RuntimeDocumentRoom.authenticate` then re-checks by exact equality.
   */
  private authForRoutedDocument(
    message: AuthMessage | LegacyAuthMessage,
  ): AuthMessage | LegacyAuthMessage | null {
    const documentId = normalizeDocumentId(message.documentId);
    if (documentId === null || documentId !== this.attachment.documentId) {
      return null;
    }
    return { ...message, documentId };
  }

  private persistReady(message: LegacyReadyMessage | ReadyMessage): void {
    const auth = this.pendingAuth;
    if (auth === null) {
      throw new Error(
        "Ready was sent without a pending authentication message",
      );
    }
    const attachment = attachmentAfterReady(
      this.attachment,
      auth,
      message,
      Date.now(),
    );
    if (attachment === null) {
      throw new Error("Authenticated collaboration metadata is inconsistent");
    }
    this.replaceAttachment(attachment);
  }

  private replaceAttachment(attachment: DocumentWebSocketAttachment): void {
    this.socket.serializeAttachment(attachment);
    this.attachment = attachment;
  }

  private async cleanupNow(): Promise<void> {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    await this.room.leave(this);
  }
}

interface RestoredPeer {
  readonly attachment: DocumentWebSocketAttachment;
  readonly peer: DurableObjectRoomPeer;
  readonly socket: WebSocket;
}

const CLOSE_ECHO_FALLBACK = {
  messageType: "websocket-close-echo",
  reason: "Collaboration connection closed",
} as const;

export class DocumentRoomDO extends DurableObject<Env> {
  private documentId: string | null = null;
  private initializationPromise: Promise<void> | null = null;
  private readonly peers = new Map<string, DurableObjectRoomPeer>();
  private room: DocumentRoom | null = null;

  protected createServices(documentId: string): DocumentRoomServices {
    return createRoomServices(this.env, documentId);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const documentId = documentIdFromRequestUrl(request.url);
    if (documentId === null) {
      return Response.json({ error: "Invalid document id" }, { status: 400 });
    }

    let room: DocumentRoom | null;
    try {
      room = await this.ensureRoom(documentId);
    } catch (error) {
      logError(error, { documentId, messageType: "room-restore" });
      return Response.json(
        { error: "Document room unavailable" },
        { status: 503 },
      );
    }
    if (room === null) {
      return Response.json(
        { error: "Durable Object document mismatch" },
        { status: 409 },
      );
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment = createAwaitingAuthAttachment(documentId);
    let peer: DurableObjectRoomPeer | null = null;
    try {
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment(attachment);
      peer = new DurableObjectRoomPeer(room, server, attachment);
      this.peers.set(peer.id, peer);
      await room.join(peer);
      await scheduleAlarmAt(
        this.ctx.storage,
        authDeadlineFrom(attachment.connectedAt),
      );
    } catch (error) {
      logError(error, { documentId, messageType: "room-join" });
      if (peer !== null) await peer.transportClosed();
      this.failSocket(server, 1011, "Document room unavailable", {
        documentId,
        messageType: "room-join-close",
      });
      this.peers.delete(attachment.peerId);
      return Response.json(
        { error: "Document room unavailable" },
        { status: 503 },
      );
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = this.attachmentFromSocket(socket);
    if (attachment === null) {
      this.failSocket(socket, 1008, "Invalid collaboration connection", {
        messageType: "invalid-websocket-attachment",
      });
      return;
    }

    try {
      const room = await this.ensureRoom(attachment.documentId);
      if (room === null) {
        this.failSocket(socket, 1008, "Invalid collaboration document", {
          documentId: attachment.documentId,
          messageType: "websocket-document-mismatch",
          peerId: attachment.peerId,
        });
        return;
      }
      const peer = await this.ensurePeer(socket, attachment, room);
      if (peer === null) return;
      await peer.dispatch(message);
      if (!peer.active) this.peers.delete(peer.id);
    } catch (error) {
      logError(error, {
        documentId: attachment.documentId,
        messageType: "websocket-message",
        peerId: attachment.peerId,
      });
      this.failSocket(socket, 1011, "Collaboration runtime failure", {
        documentId: attachment.documentId,
        messageType: "websocket-message-close",
        peerId: attachment.peerId,
      });
    }
  }

  async webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    const peer = this.peerFromSocket(socket);
    completeClose(socket, code, reason, CLOSE_ECHO_FALLBACK);
    if (peer === null) return;
    await peer.transportClosed();
    this.peers.delete(peer.id);
  }

  async webSocketError(socket: WebSocket, error: unknown): Promise<void> {
    const peer = this.peerFromSocket(socket);
    if (peer === null) {
      logError(error, { messageType: "untracked-websocket-error" });
      this.failSocket(socket, 1011, "Collaboration transport failure", {
        messageType: "untracked-websocket-error-close",
      });
      return;
    }
    await peer.transportError(error);
    this.peers.delete(peer.id);
  }

  /**
   * The authentication deadline, and nothing else. A document room needs no
   * periodic timer — authorization and lease maintenance are message-driven —
   * so this alarm is scheduled only while a socket is still awaiting `Auth`
   * and re-arms only while one remains: an idle authenticated room still
   * hibernates with no timer at all.
   *
   * Enforcement reads each socket's attachment rather than in-memory state,
   * so a woken object evicts exactly the sockets a live one would. That is
   * what replaces the deadline the removed Worker proxy held in a
   * `setTimeout` no hibernating object could keep, and it needs no room, no
   * session revalidation, and no Supabase call to run.
   */
  async alarm(): Promise<void> {
    const { expired, nextDeadline } = planAuthDeadlineSweep(
      this.pendingAuthSockets(),
      Date.now(),
    );
    await Promise.all(
      expired.map((socket) => this.closeUnauthenticated(socket)),
    );
    await scheduleAlarmAt(this.ctx.storage, nextDeadline);
  }

  /** Shared with `PresenceRoomDO`; `auth-deadline.ts` owns the policy. */
  private pendingAuthSockets(): readonly PendingAuthSocket[] {
    return collectPendingAuthSockets(this.ctx.getWebSockets(), (socket) => {
      const attachment = this.attachmentFromSocket(socket);
      return attachment !== null && attachment.phase === "awaiting-auth"
        ? attachment.connectedAt
        : null;
    });
  }

  /**
   * Never rejects. One socket that resists closing must not cancel the other
   * evictions or the re-arm that keeps the deadline enforceable at all — an
   * `alarm()` that throws has already been consumed, so an escaping error is
   * exactly how "nothing evicts them" would come back. A socket left open by
   * a failed close is still awaiting `Auth`, so the next sweep finds it again.
   */
  private async closeUnauthenticated(socket: WebSocket): Promise<void> {
    const attachment = this.attachmentFromSocket(socket);
    const identity = {
      documentId: attachment?.documentId ?? this.documentId,
      peerId: attachment?.peerId ?? null,
    };
    try {
      logMetric({ ...identity, type: "auth-deadline-expired" });
      const peer = this.peerFromSocket(socket);
      if (peer === null) {
        // A woken object holds no peer for a hibernating socket; closing the
        // transport is the whole cleanup, since an unauthenticated peer never
        // took a session or a connection lease.
        socket.close(AUTH_DEADLINE_CLOSE_CODE, AUTH_DEADLINE_CLOSE_REASON);
        return;
      }
      peer.close(AUTH_DEADLINE_CLOSE_CODE, AUTH_DEADLINE_CLOSE_REASON);
      await peer.transportClosed();
      this.peers.delete(peer.id);
    } catch (error) {
      logError(error, { ...identity, messageType: "auth-deadline-close" });
    }
  }

  private async ensureRoom(documentId: string): Promise<DocumentRoom | null> {
    if (this.documentId !== null && this.documentId !== documentId) return null;
    if (this.room === null) {
      this.documentId = documentId;
      this.room = createDocumentRoom(
        documentId,
        this.createServices(documentId),
        { refreshMode: DOCUMENT_ROOM_REFRESH_MODE.OnMessage },
      );
    }
    if (this.initializationPromise === null) {
      this.initializationPromise = this.restoreAttachedSockets(
        documentId,
        this.room,
      ).catch((error: unknown) => {
        this.initializationPromise = null;
        throw error;
      });
    }
    await this.initializationPromise;
    return this.room;
  }

  private async restoreAttachedSockets(
    documentId: string,
    room: DocumentRoom,
  ): Promise<void> {
    const restored: RestoredPeer[] = [];
    try {
      for (const socket of this.ctx.getWebSockets()) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        const attachment = this.attachmentFromSocket(socket);
        if (attachment === null || attachment.documentId !== documentId) {
          this.failSocket(socket, 1008, "Invalid collaboration connection", {
            documentId,
            messageType: "websocket-restore-invalid-attachment",
          });
          continue;
        }
        if (this.peers.has(attachment.peerId)) {
          this.failSocket(socket, 1008, "Duplicate collaboration connection", {
            documentId,
            messageType: "websocket-restore-duplicate-peer",
            peerId: attachment.peerId,
          });
          continue;
        }
        const peer = new DurableObjectRoomPeer(room, socket, attachment);
        this.peers.set(peer.id, peer);
        restored.push({ attachment, peer, socket });
      }

      await Promise.all(
        restored.map(async ({ peer }) => {
          try {
            await room.join(peer);
          } catch (error) {
            await peer.fail(error, "websocket-restore-join");
            this.peers.delete(peer.id);
          }
        }),
      );
      await Promise.all(
        restored.map(async ({ attachment, peer, socket }) => {
          if (
            attachment.phase !== "authenticated" ||
            this.peers.get(peer.id) !== peer
          ) {
            return;
          }
          const state = resumeStateFromAttachment(attachment);
          if (state === null) {
            this.failSocket(socket, 1008, "Invalid collaboration session", {
              documentId,
              messageType: "websocket-restore-invalid-session",
              peerId: peer.id,
            });
            await peer.transportClosed();
            this.peers.delete(peer.id);
            return;
          }
          try {
            await peer.resume(state);
          } catch (error) {
            await peer.fail(error, "websocket-restore-resume");
            this.peers.delete(peer.id);
            return;
          }
          if (!peer.active) this.peers.delete(peer.id);
        }),
      );
    } catch (error) {
      await this.discardRestoredPeers(restored);
      this.room = null;
      throw error;
    }
    // The alarm itself survives hibernation in storage, so this only covers a
    // deadline left unscheduled by an earlier failed write; a deadline already
    // past schedules an immediate wake-up rather than closing sockets here.
    await scheduleAlarmAt(
      this.ctx.storage,
      earliestAuthDeadline(this.pendingAuthSockets()),
    );
  }

  private async discardRestoredPeers(
    restored: ReadonlyArray<RestoredPeer>,
  ): Promise<void> {
    await Promise.all(
      restored.map(async ({ peer }) => {
        if (this.peers.get(peer.id) !== peer) return;
        await peer.transportClosed();
        this.peers.delete(peer.id);
      }),
    );
  }

  private async ensurePeer(
    socket: WebSocket,
    attachment: DocumentWebSocketAttachment,
    room: DocumentRoom,
  ): Promise<DurableObjectRoomPeer | null> {
    if (socket.readyState !== WebSocket.OPEN) return null;
    const existing = this.peers.get(attachment.peerId);
    if (existing !== undefined) {
      if (existing.ownsSocket(socket)) return existing;
      this.failSocket(socket, 1008, "Duplicate collaboration connection", {
        documentId: attachment.documentId,
        messageType: "websocket-duplicate-peer",
        peerId: attachment.peerId,
      });
      return null;
    }
    const peer = new DurableObjectRoomPeer(room, socket, attachment);
    this.peers.set(peer.id, peer);
    try {
      await room.join(peer);
      if (attachment.phase === "authenticated") {
        const state = resumeStateFromAttachment(attachment);
        if (state === null)
          throw new Error("Invalid resumed collaboration state");
        await peer.resume(state);
      }
    } catch (error) {
      await peer.fail(error, "websocket-peer-restore");
    }
    if (peer.active) return peer;
    this.peers.delete(peer.id);
    return null;
  }

  private attachmentFromSocket(
    socket: WebSocket,
  ): DocumentWebSocketAttachment | null {
    try {
      const value: unknown = socket.deserializeAttachment();
      return parseDocumentWebSocketAttachment(value);
    } catch (error) {
      logError(error, { messageType: "websocket-attachment-read" });
      return null;
    }
  }

  private peerFromSocket(socket: WebSocket): DurableObjectRoomPeer | null {
    const attachment = this.attachmentFromSocket(socket);
    if (attachment !== null) {
      const peer = this.peers.get(attachment.peerId);
      if (peer !== undefined) {
        return peer.ownsSocket(socket) ? peer : null;
      }
    }
    return (
      [...this.peers.values()].find((peer) => peer.ownsSocket(socket)) ?? null
    );
  }

  private failSocket(
    socket: WebSocket,
    code: number,
    reason: string,
    context: Readonly<Record<string, unknown>>,
  ): void {
    logError(new Error(reason), context);
    try {
      if (socket.readyState < WebSocket.CLOSING) socket.close(code, reason);
    } catch (error) {
      logError(error, { ...context, messageType: "websocket-fail-close" });
    }
  }
}
