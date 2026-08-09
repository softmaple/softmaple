import {
  COLLAB_GATEWAY_AUTH_HEADER_NAMES,
  createCollabGatewayAuthHeaders,
  parseCollabGatewaySignerConfig,
} from "@softmaple/collab-gateway-auth";
import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

const COLLAB_GATEWAY_ROUTES = {
  "/collab/document": { backendPath: "/document", query: "none" },
  "/collab/presence": { backendPath: "/presence", query: "room" },
} as const;
type CollabGatewayPath = keyof typeof COLLAB_GATEWAY_ROUTES;
const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_FORWARDED_HEADERS = Object.freeze([
  "authorization",
  "cookie",
  "proxy-authorization",
]);

const badRequest = (): NextResponse =>
  new NextResponse("Invalid WebSocket upgrade", { status: 400 });

const forbidden = (): NextResponse =>
  new NextResponse("WebSocket origin is not allowed", { status: 403 });

const configurationUnavailable = (): NextResponse =>
  new NextResponse("Collaboration gateway is unavailable", { status: 503 });

const isWebSocketUpgrade = (request: NextRequest): boolean => {
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

const isSameOriginBrowserRequest = (request: NextRequest): boolean => {
  const origin = request.headers.get("origin");
  if (origin === null || origin === "null") return false;
  try {
    const parsedOrigin = new URL(origin).origin;
    return parsedOrigin === request.nextUrl.origin && origin === parsedOrigin;
  } catch {
    return false;
  }
};

const collabBackendUrl = (
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

const hasValidGatewayQuery = (
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

const collabGatewayRewrite = (
  request: NextRequest,
  path: CollabGatewayPath,
): NextResponse => {
  if (
    request.method !== "GET" ||
    request.nextUrl.pathname !== path ||
    !hasValidGatewayQuery(request, path) ||
    !isWebSocketUpgrade(request)
  ) {
    return badRequest();
  }
  if (!isSameOriginBrowserRequest(request)) return forbidden();

  let backendUrl: URL;
  let signerConfig;
  try {
    backendUrl = collabBackendUrl(
      process.env.COLLAB_BACKEND_ORIGIN,
      COLLAB_GATEWAY_ROUTES[path].backendPath,
    );
    if (COLLAB_GATEWAY_ROUTES[path].query === "room") {
      backendUrl.search = request.nextUrl.search;
    }
    signerConfig = parseCollabGatewaySignerConfig(
      process.env.COLLAB_GATEWAY_HMAC_KEY_ID,
      process.env.COLLAB_GATEWAY_HMAC_SECRET,
    );
  } catch (error) {
    console.error("Collaboration gateway configuration failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return configurationUnavailable();
  }

  const webSocketKey = request.headers.get("sec-websocket-key");
  if (webSocketKey === null) return badRequest();

  let authHeaders: Headers;
  try {
    authHeaders = createCollabGatewayAuthHeaders({
      config: signerConfig,
      webSocketKey,
    });
  } catch {
    return badRequest();
  }

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

  return NextResponse.rewrite(backendUrl, {
    request: { headers: forwardedHeaders },
  });
};

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/collab/document" || path === "/collab/presence") {
    return collabGatewayRewrite(request, path);
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
