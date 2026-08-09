import {
  COLLAB_GATEWAY_AUTH_HEADER_NAMES,
  createCollabGatewayAuthHeaders,
  parseCollabGatewaySignerConfig,
} from "@softmaple/collab-gateway-auth";
import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

const COLLAB_GATEWAY_PATH = "/collab/document";
const COLLAB_BACKEND_PATH = "/document";
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

const collabBackendUrl = (configuredOrigin: string | undefined): URL => {
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
  return new URL(COLLAB_BACKEND_PATH, origin);
};

const collabGatewayRewrite = (request: NextRequest): NextResponse => {
  if (
    request.method !== "GET" ||
    request.nextUrl.pathname !== COLLAB_GATEWAY_PATH ||
    request.nextUrl.search !== "" ||
    !isWebSocketUpgrade(request)
  ) {
    return badRequest();
  }
  if (!isSameOriginBrowserRequest(request)) return forbidden();

  let backendUrl: URL;
  let signerConfig;
  try {
    backendUrl = collabBackendUrl(process.env.COLLAB_BACKEND_ORIGIN);
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
  if (request.nextUrl.pathname === COLLAB_GATEWAY_PATH) {
    return collabGatewayRewrite(request);
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
