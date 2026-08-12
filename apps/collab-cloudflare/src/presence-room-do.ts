import { DurableObject } from "cloudflare:workers";
import {
  createPresenceRoom,
  PRESENCE_ROOM_REFRESH_MODE,
  type PresencePeer,
  type PresencePeerSnapshot,
  type PresenceRoom,
  type PresenceRoomResumeState,
  type PresenceRoomServices,
} from "@softmaple/collab-runtime";
import {
  logError,
  MAX_PERSISTED_PRESENCE_BYTES,
  MAX_PRESENCE_MESSAGE_BYTES,
  PRESENCE_ALARM_INTERVAL_MS,
} from "./constants";
import { normalizeDocumentId } from "./document-id";
import {
  attachmentAfterSnapshot,
  createAwaitingAuthAttachment,
  parsePresenceWebSocketAttachment,
  resumeStateFromAttachment,
  type PresenceWebSocketAttachment,
} from "./presence-attachment";
import { createPresenceServices } from "./presence-services";

const textFromMessage = (message: string | ArrayBuffer): string =>
  typeof message === "string" ? message : new TextDecoder().decode(message);

const messageBytes = (message: string | ArrayBuffer): number =>
  typeof message === "string"
    ? new TextEncoder().encode(message).byteLength
    : message.byteLength;

const jsonBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

class DurableObjectPresencePeer implements PresencePeer {
  readonly id: string;

  private attachment: PresenceWebSocketAttachment;
  private cleanedUp = false;
  private closeRequested = false;
  private messageQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly room: PresenceRoom,
    private readonly socket: WebSocket,
    attachment: PresenceWebSocketAttachment,
  ) {
    this.attachment = attachment;
    this.id = attachment.peerId;
  }

  get active(): boolean {
    return !this.cleanedUp && !this.closeRequested;
  }

  get roomId(): string {
    return this.attachment.roomId;
  }

  ownsSocket(socket: WebSocket): boolean {
    return this.socket === socket;
  }

  dispatch(rawMessage: string | ArrayBuffer): Promise<void> {
    return this.enqueue(async () => {
      await this.receive(rawMessage);
    });
  }

  resume(state: PresenceRoomResumeState): Promise<void> {
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
      if (this.closeRequested) await this.cleanupNow();
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
      messageType: "presence-websocket-error",
      peerId: this.id,
      roomId: this.roomId,
    });
    this.close(1011, "Presence transport failure");
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

  send(frame: unknown): void {
    if (this.closeRequested || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(frame));
  }

  /**
   * Every field in `PresencePeerSnapshot` is server-resolved, so this only
   * fails if a future codec change breaks the persisted-size invariant that
   * `parsePresenceAuth`'s field bounds otherwise guarantee. A throw here is
   * reported by the room but never changes room behavior (see `PresencePeer`).
   */
  persist(snapshot: PresencePeerSnapshot): void {
    const attachment = attachmentAfterSnapshot(this.attachment, snapshot);
    if (jsonBytes(attachment) > MAX_PERSISTED_PRESENCE_BYTES) {
      throw new Error(
        "Presence snapshot exceeds the persisted attachment budget",
      );
    }
    this.replaceAttachment(attachment);
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const queued = this.messageQueue.then(operation, operation);
    const guarded = queued.catch(async (error: unknown) => {
      await this.handleFailure(error, "presence-websocket");
    });
    this.messageQueue = guarded;
    return guarded;
  }

  private async handleFailure(
    error: unknown,
    messageType: string,
  ): Promise<void> {
    logError(error, { messageType, peerId: this.id, roomId: this.roomId });
    this.close(1011, "Presence runtime failure");
    try {
      await this.cleanupNow();
    } catch (cleanupError) {
      logError(cleanupError, {
        messageType: "presence-websocket-cleanup",
        peerId: this.id,
        roomId: this.roomId,
      });
    }
  }

  private async receive(rawMessage: string | ArrayBuffer): Promise<void> {
    if (this.cleanedUp || this.closeRequested) return;
    if (messageBytes(rawMessage) > MAX_PRESENCE_MESSAGE_BYTES) {
      this.close(1009, "Presence frame is too large");
      await this.cleanupNow();
      return;
    }
    await this.room.receive(this, textFromMessage(rawMessage));
    if (this.closeRequested) await this.cleanupNow();
  }

  private replaceAttachment(attachment: PresenceWebSocketAttachment): void {
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
  readonly attachment: PresenceWebSocketAttachment;
  readonly peer: DurableObjectPresencePeer;
  readonly socket: WebSocket;
}

/**
 * A Durable Object namespace fully independent from `DocumentRoomDO`: no
 * shared capability instance, no cross-stub call, and no imports from the
 * document object's adapters (see docs/design/collaboration-runtime.md's
 * "Presence room" section). One object instance coordinates every live
 * connection for one presence room, routed directly on `?roomId=` — unlike
 * `DocumentRoomDO`, there is no auth-sniffing proxy in front of it, because
 * the room id is already known from the upgrade request's query string.
 */
export class PresenceRoomDO extends DurableObject<Env> {
  private initializationPromise: Promise<void> | null = null;
  private readonly peers = new Map<string, DurableObjectPresencePeer>();
  private room: PresenceRoom | null = null;
  /** Protected so a test subclass can scope an in-memory backend to this room. */
  protected roomId: string | null = null;

  protected createServices(): PresenceRoomServices {
    return createPresenceServices(this.env, this.ctx.storage);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const rawRoomId = new URL(request.url).searchParams.get("roomId");
    const roomId = rawRoomId === null ? null : normalizeDocumentId(rawRoomId);
    if (roomId === null) {
      return Response.json({ error: "Invalid presence room" }, { status: 400 });
    }

    let room: PresenceRoom | null;
    try {
      room = await this.ensureRoom(roomId);
    } catch (error) {
      logError(error, { messageType: "presence-room-restore", roomId });
      return Response.json(
        { error: "Presence room unavailable" },
        { status: 503 },
      );
    }
    if (room === null) {
      return Response.json(
        { error: "Durable Object presence room mismatch" },
        { status: 409 },
      );
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment = createAwaitingAuthAttachment(roomId);
    let peer: DurableObjectPresencePeer | null = null;
    try {
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment(attachment);
      peer = new DurableObjectPresencePeer(room, server, attachment);
      this.peers.set(peer.id, peer);
      await room.join(peer);
      await this.ensureAlarmScheduled();
    } catch (error) {
      logError(error, { messageType: "presence-room-join", roomId });
      if (peer !== null) await peer.transportClosed();
      this.failSocket(server, 1011, "Presence room unavailable", {
        messageType: "presence-room-join-close",
        roomId,
      });
      this.peers.delete(attachment.peerId);
      return Response.json(
        { error: "Presence room unavailable" },
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
      this.failSocket(socket, 1008, "Invalid presence connection", {
        messageType: "invalid-presence-attachment",
      });
      return;
    }

    try {
      const room = await this.ensureRoom(attachment.roomId);
      if (room === null) {
        this.failSocket(socket, 1008, "Invalid presence room", {
          messageType: "presence-websocket-room-mismatch",
          peerId: attachment.peerId,
          roomId: attachment.roomId,
        });
        return;
      }
      const peer = await this.ensurePeer(socket, attachment, room);
      if (peer === null) return;
      await peer.dispatch(message);
      if (!peer.active) this.peers.delete(peer.id);
    } catch (error) {
      logError(error, {
        messageType: "presence-websocket-message",
        peerId: attachment.peerId,
        roomId: attachment.roomId,
      });
      this.failSocket(socket, 1011, "Presence runtime failure", {
        messageType: "presence-websocket-message-close",
        peerId: attachment.peerId,
        roomId: attachment.roomId,
      });
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const peer = this.peerFromSocket(socket);
    if (peer === null) return;
    await peer.transportClosed();
    this.peers.delete(peer.id);
  }

  async webSocketError(socket: WebSocket, error: unknown): Promise<void> {
    const peer = this.peerFromSocket(socket);
    if (peer === null) {
      logError(error, { messageType: "untracked-presence-websocket-error" });
      this.failSocket(socket, 1011, "Presence transport failure", {
        messageType: "untracked-presence-websocket-error-close",
      });
      return;
    }
    await peer.transportError(error);
    this.peers.delete(peer.id);
  }

  /**
   * The only timer mechanism that survives hibernation; drives
   * `PresenceRoom.sweep()`. A hibernation eviction resets every in-memory
   * field, including `this.roomId`, so this recovers it from an attached
   * socket the same way `webSocketMessage` does before falling back to a
   * no-op (nothing to sweep without a room id or any attached socket).
   */
  async alarm(): Promise<void> {
    const roomId = this.roomId ?? this.roomIdFromAnySocket();
    if (roomId !== null) {
      try {
        const room = await this.ensureRoom(roomId);
        await room?.sweep(Date.now());
      } catch (error) {
        logError(error, { messageType: "presence-alarm", roomId });
      }
    }
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + PRESENCE_ALARM_INTERVAL_MS);
    }
  }

  private roomIdFromAnySocket(): string | null {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachmentFromSocket(socket);
      if (attachment !== null) return attachment.roomId;
    }
    return null;
  }

  private async ensureAlarmScheduled(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + PRESENCE_ALARM_INTERVAL_MS);
    }
  }

  private async ensureRoom(roomId: string): Promise<PresenceRoom | null> {
    if (this.roomId !== null && this.roomId !== roomId) return null;
    if (this.room === null) {
      this.roomId = roomId;
      this.room = createPresenceRoom(roomId, this.createServices(), {
        refreshMode: PRESENCE_ROOM_REFRESH_MODE.OnMessage,
      });
    }
    if (this.initializationPromise === null) {
      this.initializationPromise = this.restoreAttachedSockets(
        roomId,
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
    roomId: string,
    room: PresenceRoom,
  ): Promise<void> {
    const restored: RestoredPeer[] = [];
    try {
      for (const socket of this.ctx.getWebSockets()) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        const attachment = this.attachmentFromSocket(socket);
        if (attachment === null || attachment.roomId !== roomId) {
          this.failSocket(socket, 1008, "Invalid presence connection", {
            messageType: "presence-websocket-restore-invalid-attachment",
            roomId,
          });
          continue;
        }
        if (this.peers.has(attachment.peerId)) {
          this.failSocket(socket, 1008, "Duplicate presence connection", {
            messageType: "presence-websocket-restore-duplicate-peer",
            peerId: attachment.peerId,
            roomId,
          });
          continue;
        }
        const peer = new DurableObjectPresencePeer(room, socket, attachment);
        this.peers.set(peer.id, peer);
        restored.push({ attachment, peer, socket });
      }

      await Promise.all(
        restored.map(async ({ peer }) => {
          try {
            await room.join(peer);
          } catch (error) {
            await peer.fail(error, "presence-websocket-restore-join");
            this.peers.delete(peer.id);
          }
        }),
      );
      await Promise.all(
        restored.map(async ({ attachment, peer }) => {
          if (
            attachment.phase !== "authenticated" ||
            this.peers.get(peer.id) !== peer
          ) {
            return;
          }
          try {
            await peer.resume(resumeStateFromAttachment(attachment));
          } catch (error) {
            await peer.fail(error, "presence-websocket-restore-resume");
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
    attachment: PresenceWebSocketAttachment,
    room: PresenceRoom,
  ): Promise<DurableObjectPresencePeer | null> {
    if (socket.readyState !== WebSocket.OPEN) return null;
    const existing = this.peers.get(attachment.peerId);
    if (existing !== undefined) {
      if (existing.ownsSocket(socket)) return existing;
      this.failSocket(socket, 1008, "Duplicate presence connection", {
        messageType: "presence-websocket-duplicate-peer",
        peerId: attachment.peerId,
        roomId: attachment.roomId,
      });
      return null;
    }
    const peer = new DurableObjectPresencePeer(room, socket, attachment);
    this.peers.set(peer.id, peer);
    try {
      await room.join(peer);
      if (attachment.phase === "authenticated") {
        await peer.resume(resumeStateFromAttachment(attachment));
      }
    } catch (error) {
      await peer.fail(error, "presence-websocket-peer-restore");
    }
    if (peer.active) return peer;
    this.peers.delete(peer.id);
    return null;
  }

  private attachmentFromSocket(
    socket: WebSocket,
  ): PresenceWebSocketAttachment | null {
    try {
      const value: unknown = socket.deserializeAttachment();
      return parsePresenceWebSocketAttachment(value);
    } catch (error) {
      logError(error, { messageType: "presence-websocket-attachment-read" });
      return null;
    }
  }

  private peerFromSocket(socket: WebSocket): DurableObjectPresencePeer | null {
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
      logError(error, {
        ...context,
        messageType: "presence-websocket-fail-close",
      });
    }
  }
}
