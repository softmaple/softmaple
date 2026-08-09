import { type NextRequest, NextResponse } from "next/server";
import {
  type CollabGatewayPath,
  badRequest,
  buildSignedUpgradeHeaders,
  configurationUnavailable,
  forbidden,
  hasValidGatewayQuery,
  isSameOriginBrowserRequest,
  isWebSocketUpgrade,
  resolveCollabGatewayTarget,
  usesVercelWebSocketBridge,
} from "@/lib/collab-gateway";
import { updateSession } from "@/utils/supabase/middleware";

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

  // On Vercel, App Router + @vercel/functions terminates the upgrade and
  // opens a signed outbound socket. NextResponse.rewrite cannot proxy
  // WebSocket Upgrades to a separate collab host.
  if (usesVercelWebSocketBridge()) {
    return NextResponse.next();
  }

  let backendUrl: URL;
  let signerConfig;
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

  try {
    const forwardedHeaders = buildSignedUpgradeHeaders({
      request,
      backendUrl,
      signerConfig,
    });
    return NextResponse.rewrite(backendUrl, {
      request: { headers: forwardedHeaders },
    });
  } catch {
    return badRequest();
  }
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
