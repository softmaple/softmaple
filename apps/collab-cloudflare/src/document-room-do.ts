import { DurableObject } from "cloudflare:workers";
import {
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  parseClientCollabMessage,
  type ClientCollabMessage,
  type ServerCollabMessage,
  type SupportedCollabProtocolVersion,
} from "@softmaple/collab-protocol";
import {
  createDocumentRoom,
  type DocumentRoom,
  type DocumentRoomServices,
  type RoomPeer,
} from "@softmaple/collab-runtime";
import {
  errorMessage,
  logError,
  MAX_MESSAGE_BYTES,
  MESSAGE_RATE_LIMIT_MAX,
  MESSAGE_RATE_LIMIT_WINDOW_MS,
} from "./constants";
import { documentIdFromRoomPath } from "./document-id";
import { createRoomServices } from "./room-services";

interface MessageQuota {
  readonly count: number;
  readonly windowStartedAt: number;
}

const textFromMessage = (message: string | ArrayBuffer): string =>
  typeof message === "string" ? message : new TextDecoder().decode(message);

const messageBytes = (message: string | ArrayBuffer): number =>
  typeof message === "string"
    ? new TextEncoder().encode(message).byteLength
    : message.byteLength;

class DurableObjectRoomPeer implements RoomPeer {
  readonly id = crypto.randomUUID();

  private cleanedUp = false;
  private closeRequested = false;
  private messageQueue: Promise<void> = Promise.resolve();
  private protocolVersion: SupportedCollabProtocolVersion =
    COLLAB_PROTOCOL_VERSION;
  private quota: MessageQuota = { count: 0, windowStartedAt: Date.now() };

  constructor(
    private readonly documentId: string,
    private readonly room: DocumentRoom,
    private readonly socket: WebSocket,
  ) {}

  start(): void {
    this.socket.addEventListener("message", (event) => {
      this.enqueue(async () => {
        await this.receive(event.data);
      });
    });
    this.socket.addEventListener("close", () => {
      this.enqueue(async () => {
        await this.cleanup();
      });
    });
    this.socket.addEventListener("error", () => {
      this.enqueue(async () => {
        await this.cleanup();
      });
    });
  }

  close(code: number, reason: string): void {
    if (this.closeRequested) return;
    this.closeRequested = true;
    if (this.socket.readyState < 2) this.socket.close(code, reason);
  }

  send(message: ServerCollabMessage): void {
    if (this.closeRequested || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify(message));
    if (message.type === COLLAB_MESSAGE_TYPE.Ready) {
      this.protocolVersion = message.protocolVersion;
    }
  }

  private enqueue(operation: () => Promise<void>): void {
    this.messageQueue = this.messageQueue
      .then(operation)
      .catch(async (error: unknown) => {
        logError(error, {
          documentId: this.documentId,
          messageType: "websocket",
          peerId: this.id,
        });
        this.close(1011, "Collaboration runtime failure");
        try {
          await this.cleanup();
        } catch (cleanupError) {
          logError(cleanupError, {
            documentId: this.documentId,
            messageType: "websocket-cleanup",
            peerId: this.id,
          });
        }
      });
  }

  private consumeQuota(): boolean {
    const now = Date.now();
    if (now - this.quota.windowStartedAt >= MESSAGE_RATE_LIMIT_WINDOW_MS) {
      this.quota = { count: 1, windowStartedAt: now };
      return true;
    }
    if (this.quota.count >= MESSAGE_RATE_LIMIT_MAX) return false;
    this.quota = { ...this.quota, count: this.quota.count + 1 };
    return true;
  }

  private async receive(rawMessage: string | ArrayBuffer): Promise<void> {
    if (this.cleanedUp || this.closeRequested) return;
    if (messageBytes(rawMessage) > MAX_MESSAGE_BYTES) {
      this.close(1009, "Collaboration message is too large");
      await this.cleanup();
      return;
    }
    if (!this.consumeQuota()) {
      this.send(
        errorMessage(
          COLLAB_ERROR_CODE.InvalidMessage,
          "Too many collaboration messages",
          true,
          this.protocolVersion,
        ),
      );
      this.close(1013, "Message rate limit exceeded");
      await this.cleanup();
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
          this.protocolVersion,
        ),
      );
      return;
    }

    await this.room.receive(this, message);
    if (this.closeRequested) await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    await this.room.leave(this);
  }
}

export class DocumentRoomDO extends DurableObject<Env> {
  private documentId: string | null = null;
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

    const documentId = documentIdFromRoomPath(new URL(request.url).pathname);
    if (documentId === null) {
      return Response.json({ error: "Invalid document id" }, { status: 400 });
    }
    if (this.documentId !== null && this.documentId !== documentId) {
      return Response.json(
        { error: "Durable Object document mismatch" },
        { status: 409 },
      );
    }
    if (this.room === null) {
      this.documentId = documentId;
      this.room = createDocumentRoom(
        documentId,
        this.createServices(documentId),
      );
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const peer = new DurableObjectRoomPeer(documentId, this.room, server);
    try {
      await this.room.join(peer);
    } catch (error) {
      logError(error, { documentId, messageType: "room-join" });
      try {
        if (server.readyState < 2) {
          server.close(1011, "Document room unavailable");
        }
      } catch (closeError) {
        logError(closeError, { documentId, messageType: "room-join-close" });
      }
      return Response.json(
        { error: "Document room unavailable" },
        { status: 503 },
      );
    }
    peer.start();
    return new Response(null, { status: 101, webSocket: client });
  }
}
