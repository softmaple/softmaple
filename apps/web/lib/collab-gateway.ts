import {
  COLLAB_GATEWAY_AUTH_HEADER_NAMES,
  createCollabGatewayAuthHeaders,
  parseCollabGatewaySignerConfig,
  type CollabGatewaySignerConfig,
} from "@softmaple/collab-gateway-auth";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const COLLAB_GATEWAY_ROUTES = {
  "/collab/document": { backendPath: "/document", query: "none" },
  "/collab/presence": { backendPath: "/presence", query: "room" },
} as const;

export type CollabGatewayPath = keyof typeof COLLAB_GATEWAY_ROUTES;

const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SENSITIVE_FORWARDED_HEADERS = Object.freeze([
  "authorization",
  "cookie",
  "proxy-authorization",
]);

export const badRequest = (): NextResponse =>
  new NextResponse("Invalid WebSocket upgrade", { status: 400 });

export const forbidden = (): NextResponse =>
  new NextResponse("WebSocket origin is not allowed", { status: 403 });

export const configurationUnavailable = (): NextResponse =>
  new NextResponse("Collaboration gateway is unavailable", { status: 503 });

export const isWebSocketUpgrade = (request: NextRequest): boolean => {
  const connectionTokens = (request.headers.get("connection") ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase());
  return (
    request.headers.get("upgrade")?.toLowerCase() === "websocket" &&
    connectionTokens.includes("upgrade") &&
    request.headers.get("sec-websocket-version") === "13" &&
    request.headers.has("sec-websocket-key")
  );
};

export const isSameOriginBrowserRequest = (request: NextRequest): boolean => {
  const origin = request.headers.get("origin");
  if (origin === null || origin === "null") return false;
  try {
    const parsedOrigin = new URL(origin).origin;
    return parsedOrigin === request.nextUrl.origin && origin === parsedOrigin;
  } catch {
    return false;
  }
};

export const collabBackendUrl = (
  configuredOrigin: string | undefined,
  backendPath: string,
): URL => {
  if (configuredOrigin === undefined) {
    throw new Error("COLLAB_BACKEND_ORIGIN is missing");
  }
  const origin = new URL(configuredOrigin);
  if (
    (origin.protocol !== "http:" && origin.protocol !== "https:") ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new Error("COLLAB_BACKEND_ORIGIN must be an HTTP origin");
  }
  return new URL(backendPath, origin);
};

export const hasValidGatewayQuery = (
  request: NextRequest,
  path: CollabGatewayPath,
): boolean => {
  const route = COLLAB_GATEWAY_ROUTES[path];
  if (route.query === "none") return request.nextUrl.search === "";
  const entries = [...request.nextUrl.searchParams.entries()];
  return (
    entries.length === 1 &&
    entries[0]?.[0] === "roomId" &&
    DOCUMENT_ID_PATTERN.test(entries[0]?.[1] ?? "")
  );
};

export const resolveCollabGatewayTarget = (
  path: CollabGatewayPath,
  search: string,
): {
  readonly backendUrl: URL;
  readonly signerConfig: CollabGatewaySignerConfig;
} => {
  const backendUrl = collabBackendUrl(
    process.env.COLLAB_BACKEND_ORIGIN,
    COLLAB_GATEWAY_ROUTES[path].backendPath,
  );
  if (COLLAB_GATEWAY_ROUTES[path].query === "room") {
    backendUrl.search = search;
  }
  const signerConfig = parseCollabGatewaySignerConfig(
    process.env.COLLAB_GATEWAY_HMAC_KEY_ID,
    process.env.COLLAB_GATEWAY_HMAC_SECRET,
  );
  return { backendUrl, signerConfig };
};

/** Vercel Functions can terminate WebSockets; stock Next rewrite cannot. */
export const usesVercelWebSocketBridge = (): boolean =>
  process.env.VERCEL === "1";

export const buildSignedUpgradeHeaders = ({
  request,
  backendUrl,
  signerConfig,
}: {
  readonly request: NextRequest;
  readonly backendUrl: URL;
  readonly signerConfig: CollabGatewaySignerConfig;
}): Headers => {
  const webSocketKey = request.headers.get("sec-websocket-key");
  if (webSocketKey === null) {
    throw new Error("sec-websocket-key is missing");
  }
  const authHeaders = createCollabGatewayAuthHeaders({
    config: signerConfig,
    webSocketKey,
    path: `${backendUrl.pathname}${backendUrl.search}`,
  });

  const forwardedHeaders = new Headers(request.headers);
  for (const header of SENSITIVE_FORWARDED_HEADERS) {
    forwardedHeaders.delete(header);
  }
  for (const header of COLLAB_GATEWAY_AUTH_HEADER_NAMES) {
    forwardedHeaders.delete(header);
  }
  authHeaders.forEach((value, header) => {
    forwardedHeaders.set(header, value);
  });
  return forwardedHeaders;
};
