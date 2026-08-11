import {
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  parseClientCollabMessage,
  type AuthMessage,
  type LegacyAuthMessage,
  type ServerCollabMessage,
} from "@softmaple/collab-protocol";
import { errorMessage, logError, MAX_MESSAGE_BYTES } from "./constants";
import { documentRoomPath, normalizeDocumentId } from "./document-id";

const textFromMessage = (message: string | ArrayBuffer): string =>
  typeof message === "string" ? message : new TextDecoder().decode(message);

const messageBytes = (message: string | ArrayBuffer): number =>
  typeof message === "string"
    ? new TextEncoder().encode(message).byteLength
    : message.byteLength;

const isAllowedOrigin = (request: Request, env: Env): boolean => {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  const allowed = env.COLLAB_ALLOWED_ORIGINS.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return allowed.includes(origin);
};

class DocumentSocketProxy {
  private closed = false;
  private messageQueue: Promise<void> = Promise.resolve();
  private upstream: WebSocket | null = null;

  constructor(
    private readonly client: WebSocket,
    private readonly env: Env,
  ) {}

  start(): void {
    this.client.addEventListener("message", (event) => {
      this.enqueue(async () => {
        await this.receive(event.data);
      });
    });
    this.client.addEventListener("close", () => {
      this.closed = true;
      this.closeUpstream(1000, "Client closed");
    });
    this.client.addEventListener("error", () => {
      this.closed = true;
      this.closeUpstream(1011, "Client transport error");
    });
  }

  private enqueue(operation: () => Promise<void>): void {
    this.messageQueue = this.messageQueue
      .then(operation)
      .catch((error: unknown) => {
        logError(error, { messageType: "websocket-proxy" });
        this.sendToClient(
          errorMessage(
            COLLAB_ERROR_CODE.AuthenticationFailed,
            "Collaboration is temporarily unavailable",
            true,
          ),
        );
        this.close(1011, "Collaboration unavailable");
      });
  }

  private async receive(rawMessage: string | ArrayBuffer): Promise<void> {
    if (this.closed) return;
    if (messageBytes(rawMessage) > MAX_MESSAGE_BYTES) {
      this.close(1009, "Collaboration message is too large");
      return;
    }
    if (this.upstream !== null) {
      if (this.upstream.readyState === 1) this.upstream.send(rawMessage);
      return;
    }

    let message: ReturnType<typeof parseClientCollabMessage>;
    try {
      message = parseClientCollabMessage(
        JSON.parse(textFromMessage(rawMessage)),
      );
    } catch (error) {
      logError(error, { messageType: "initial-auth" });
      this.sendToClient(
        errorMessage(
          COLLAB_ERROR_CODE.InvalidMessage,
          "The collaboration message is invalid",
          false,
        ),
      );
      return;
    }
    if (message.type !== COLLAB_MESSAGE_TYPE.Auth) {
      this.sendToClient(
        errorMessage(
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "Authenticate before sending collaboration messages",
          false,
          message.protocolVersion,
        ),
      );
      return;
    }

    const documentId = normalizeDocumentId(message.documentId);
    if (documentId === null) {
      this.sendToClient(
        errorMessage(
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "Authentication or document membership failed",
          false,
          message.protocolVersion,
        ),
      );
      this.close(1008, "Unauthorized");
      return;
    }

    const normalizedMessage: AuthMessage | LegacyAuthMessage = {
      ...message,
      documentId,
    };
    const stub = this.env.DOCUMENT_ROOMS.getByName(documentId);
    const response = await stub.fetch(
      new Request(
        `https://document-room.internal${documentRoomPath(documentId)}`,
        {
          headers: { Upgrade: "websocket" },
          method: "GET",
        },
      ),
    );
    const upstream = response.webSocket;
    if (response.status !== 101 || upstream === null) {
      throw new Error(`DocumentRoomDO upgrade failed with ${response.status}`);
    }
    if (this.closed) {
      upstream.accept();
      upstream.close(1000, "Client closed before routing completed");
      return;
    }

    this.upstream = upstream;
    upstream.accept();
    upstream.addEventListener("message", (event) => {
      if (!this.closed && this.client.readyState === 1) {
        this.client.send(event.data);
      }
    });
    upstream.addEventListener("close", (event) => {
      this.close(event.code, event.reason || "Document room closed");
    });
    upstream.addEventListener("error", () => {
      this.close(1011, "Document room transport error");
    });
    upstream.send(JSON.stringify(normalizedMessage));
  }

  private sendToClient(message: ServerCollabMessage): void {
    if (!this.closed && this.client.readyState === 1) {
      this.client.send(JSON.stringify(message));
    }
  }

  private close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closeUpstream(code, reason);
    if (this.client.readyState < 2) this.client.close(code, reason);
  }

  private closeUpstream(code: number, reason: string): void {
    if (
      this.upstream?.readyState !== undefined &&
      this.upstream.readyState < 2
    ) {
      this.upstream.close(code, reason);
    }
  }
}

export const handleDocumentWebSocket = (
  request: Request,
  env: Env,
): Response => {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }
  if (!isAllowedOrigin(request, env)) {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  new DocumentSocketProxy(server, env).start();
  return new Response(null, { status: 101, webSocket: client });
};
