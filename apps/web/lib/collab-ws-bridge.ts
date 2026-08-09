import {
  COLLAB_GATEWAY_AUTH_HEADER_NAMES,
  createCollabGatewayAuthHeaders,
  type CollabGatewaySignerConfig,
} from "@softmaple/collab-gateway-auth";
import {
  experimental_upgradeWebSocket,
  type WebSocketData,
} from "@vercel/functions";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { WebSocket } from "ws";
import {
  type CollabGatewayPath,
  badRequest,
  configurationUnavailable,
  forbidden,
  hasValidGatewayQuery,
  isSameOriginBrowserRequest,
  isWebSocketUpgrade,
  resolveCollabGatewayTarget,
  usesVercelWebSocketBridge,
} from "@/lib/collab-gateway";

const toWsUrl = (backendUrl: URL): string => {
  const protocol = backendUrl.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${backendUrl.host}${backendUrl.pathname}${backendUrl.search}`;
};

const headerValue = (
  value: string | string[] | number | undefined,
): string | undefined => {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : String(value);
};

const openSignedBackendSocket = (
  backendUrl: URL,
  signerConfig: CollabGatewaySignerConfig,
): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const upgradePath = `${backendUrl.pathname}${backendUrl.search}`;
    const backend = new WebSocket(toWsUrl(backendUrl), {
      finishRequest(req) {
        const webSocketKey = headerValue(req.getHeader("sec-websocket-key"));
        if (webSocketKey === undefined) {
          req.destroy(new Error("Outbound WebSocket key is missing"));
          return;
        }
        try {
          const authHeaders = createCollabGatewayAuthHeaders({
            config: signerConfig,
            webSocketKey,
            path: upgradePath,
          });
          for (const header of COLLAB_GATEWAY_AUTH_HEADER_NAMES) {
            const value = authHeaders.get(header);
            if (value !== null) req.setHeader(header, value);
          }
        } catch (error) {
          req.destroy(
            error instanceof Error
              ? error
              : new Error("Failed to sign collaboration upgrade"),
          );
          return;
        }
        req.end();
      },
    });

    const onOpen = () => {
      cleanup();
      resolve(backend);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      backend.off("open", onOpen);
      backend.off("error", onError);
    };
    backend.once("open", onOpen);
    backend.once("error", onError);
  });

const closeSocket = (
  socket: WebSocket,
  code?: number,
  reason?: string,
): void => {
  if (
    socket.readyState === WebSocket.OPEN ||
    socket.readyState === WebSocket.CONNECTING
  ) {
    socket.close(code, reason);
  }
};

const bridgeClientToBackend = async (
  client: WebSocket,
  backendUrl: URL,
  signerConfig: CollabGatewaySignerConfig,
): Promise<void> => {
  const pending: Array<{
    readonly data: WebSocketData;
    readonly binary: boolean;
  }> = [];
  let backend: WebSocket | null = null;
  let closed = false;

  const closeBoth = (code?: number, reason?: string) => {
    if (closed) return;
    closed = true;
    closeSocket(client, code, reason);
    if (backend !== null) closeSocket(backend, code, reason);
  };

  const onClientMessage = (data: WebSocketData, isBinary: boolean) => {
    if (backend?.readyState === WebSocket.OPEN) {
      backend.send(data, { binary: isBinary });
      return;
    }
    pending.push({ data, binary: isBinary });
  };

  client.on("message", onClientMessage);
  client.on("close", (code, reason) => {
    closeBoth(code, reason.toString());
  });
  client.on("error", () => {
    closeBoth(1011, "client error");
  });

  try {
    backend = await openSignedBackendSocket(backendUrl, signerConfig);
  } catch (error) {
    console.error("Collaboration backend upgrade failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    closeBoth(1011, "backend unavailable");
    return;
  }

  if (closed) {
    closeSocket(backend);
    return;
  }

  for (const message of pending) {
    if (backend.readyState !== WebSocket.OPEN) break;
    backend.send(message.data, { binary: message.binary });
  }
  pending.length = 0;

  backend.on("message", (data: WebSocketData, isBinary: boolean) => {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(data, { binary: isBinary });
  });
  backend.on("close", (code, reason) => {
    closeBoth(code, reason.toString());
  });
  backend.on("error", () => {
    closeBoth(1011, "backend error");
  });
};

/**
 * Terminate the browser WebSocket on Vercel and open a signed outbound socket
 * to the private collab origin. Stock Next.js rewrite cannot proxy Upgrades
 * across hosts, which is why split web/collab deployments fail without this.
 */
export const handleCollabWebSocketBridge = async (
  request: NextRequest,
  path: CollabGatewayPath,
): Promise<Response> => {
  if (
    request.method !== "GET" ||
    request.nextUrl.pathname !== path ||
    !hasValidGatewayQuery(request, path) ||
    !isWebSocketUpgrade(request)
  ) {
    return badRequest();
  }
  if (!isSameOriginBrowserRequest(request)) return forbidden();
  if (!usesVercelWebSocketBridge()) {
    return new NextResponse(
      "Collaboration WebSocket bridge requires the Vercel runtime",
      { status: 503 },
    );
  }

  let backendUrl: URL;
  let signerConfig: CollabGatewaySignerConfig;
  try {
    ({ backendUrl, signerConfig } = resolveCollabGatewayTarget(
      path,
      request.nextUrl.search,
    ));
  } catch (error) {
    console.error("Collaboration gateway configuration failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return configurationUnavailable();
  }

  await connection();

  return experimental_upgradeWebSocket(async (client) => {
    await bridgeClientToBackend(client, backendUrl, signerConfig);
  });
};
