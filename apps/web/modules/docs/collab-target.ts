import {
  COLLAB_RUNTIME,
  type CollabRuntime,
} from "@/modules/docs/collab-runtime-routing";

/**
 * The collaboration endpoints a single page load is bound to.
 *
 * A target is resolved on the server, immediately after the runtime decision
 * that produced it (see `collab-target.server.ts`), and handed to the browser
 * as one object. Document and presence therefore always belong to the same
 * runtime, and the client never re-derives either endpoint.
 *
 * There is deliberately no cross-runtime fallback: a document owned by
 * Cloudflare either connects to Cloudflare or fails loudly. Silently
 * answering with Nitro would let two tabs of the same document write to two
 * backends at once — a dual-write incident, not a UX papercut. See
 * apps/web/README.md#collaboration-runtime-routing.
 */
export type CollabTarget = {
  readonly documentUrl: string;
  readonly presenceUrl: string;
  readonly runtime: CollabRuntime;
};

/** Request headers used to derive the browser-visible same-origin base URL. */
export type CollabRequestHeaders = {
  readonly forwardedHost: string | null;
  readonly forwardedProto: string | null;
  readonly host: string | null;
};

export type CollabTargetInput = {
  readonly cloudflareBaseUrl: string | undefined;
  readonly documentId: string;
  readonly runtime: CollabRuntime;
  readonly sameOriginBaseUrl: string;
};

export const CLOUDFLARE_ENDPOINT_ERROR =
  "Cloudflare collaboration runtime was selected but its endpoint is not configured";

const COLLAB_DOCUMENT_PATH = "/collab/document";
const COLLAB_PRESENCE_PATH = "/collab/presence";

/** http(s) bases are accepted for convenience and normalized to ws(s). */
const SOCKET_PROTOCOL = {
  "http:": "ws:",
  "https:": "wss:",
  "ws:": "ws:",
  "wss:": "wss:",
} as const;

type SocketProtocolSource = keyof typeof SOCKET_PROTOCOL;

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isSocketProtocolSource = (
  protocol: string,
): protocol is SocketProtocolSource => Object.hasOwn(SOCKET_PROTOCOL, protocol);

/** First value of a possibly comma-joined proxy header. */
const firstHeaderValue = (raw: string | null): string | undefined => {
  const value = raw?.split(",")[0]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const isLoopbackHost = (host: string): boolean => {
  try {
    const { hostname } = new URL(`http://${host}`);
    return LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
};

const sameOriginProtocol = (
  forwardedProto: string | undefined,
  host: string,
): "ws:" | "wss:" => {
  const proto = forwardedProto?.toLowerCase();
  if (proto === "http") return "ws:";
  if (proto === "https") return "wss:";
  // No proxy hint (plain `next dev`): only loopback is assumed insecure.
  return isLoopbackHost(host) ? "ws:" : "wss:";
};

/** Same base URL with its scheme normalized to ws/wss, without mutation. */
const toSocketBaseUrl = (url: URL, protocol: SocketProtocolSource): URL =>
  new URL(`${SOCKET_PROTOCOL[protocol]}//${url.host}${url.pathname}`);

const collabSocketUrl = (
  baseUrl: URL,
  path: string,
  query: Readonly<Record<string, string>> = {},
): string => {
  const url = new URL(
    `${baseUrl.pathname.replace(/\/+$/, "")}${path}`,
    baseUrl,
  );
  url.search = new URLSearchParams(query).toString();
  return url.toString();
};

const parseSocketBaseUrl = (raw: string, describe: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${describe} is not a valid URL: "${raw}"`);
  }
  if (!isSocketProtocolSource(parsed.protocol)) {
    throw new Error(
      `${describe} must use ws://, wss://, http:// or https://: "${raw}"`,
    );
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new Error(
      `${describe} must not carry a query string or fragment: "${raw}"`,
    );
  }
  return toSocketBaseUrl(parsed, parsed.protocol);
};

const parseCloudflareBaseUrl = (raw: string | undefined): URL => {
  const trimmed = raw?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error(
      `${CLOUDFLARE_ENDPOINT_ERROR}: set COLLAB_CLOUDFLARE_WS_URL`,
    );
  }
  return parseSocketBaseUrl(trimmed, CLOUDFLARE_ENDPOINT_ERROR);
};

/**
 * Browser-visible same-origin (Nitro) WebSocket base URL for the request being
 * rendered. `vercel.json` maps `/collab/**` on the app's own origin to
 * `apps/collab-nitro`, so the request's own origin *is* the Nitro endpoint; reading
 * it from the request keeps preview deployments, custom domains and local
 * ports correct without a second environment variable to keep in sync.
 */
export const sameOriginCollabBaseUrl = ({
  forwardedHost,
  forwardedProto,
  host,
}: CollabRequestHeaders): string => {
  const resolvedHost =
    firstHeaderValue(forwardedHost) ?? firstHeaderValue(host);
  if (resolvedHost === undefined) {
    throw new Error(
      "Could not resolve the request host for same-origin collaboration endpoints",
    );
  }
  const protocol = sameOriginProtocol(
    firstHeaderValue(forwardedProto),
    resolvedHost,
  );
  return `${protocol}//${resolvedHost}`;
};

/**
 * Resolves the endpoints of the runtime that already owns the document.
 *
 * The runtime is an input, never an output: this function can fail, but it can
 * never answer with a runtime other than the one it was given.
 *
 * Cloudflare routes the upgrade to a Durable Object from the URL, so the
 * document socket carries `?documentId=`; presence takes `?roomId=` from
 * `@softmaple/awareness`, which appends it to the base URL below. Those are
 * identifiers, not credentials — authentication stays in the first protocol
 * message, so no access token ever belongs in these URLs. Nitro routes on that
 * first message instead and keeps its query-free same-origin URLs.
 */
export const resolveCollabTarget = ({
  cloudflareBaseUrl,
  documentId,
  runtime,
  sameOriginBaseUrl,
}: CollabTargetInput): CollabTarget => {
  if (runtime === COLLAB_RUNTIME.Cloudflare) {
    const base = parseCloudflareBaseUrl(cloudflareBaseUrl);
    return {
      documentUrl: collabSocketUrl(base, COLLAB_DOCUMENT_PATH, { documentId }),
      presenceUrl: collabSocketUrl(base, COLLAB_PRESENCE_PATH),
      runtime: COLLAB_RUNTIME.Cloudflare,
    };
  }
  const base = parseSocketBaseUrl(
    sameOriginBaseUrl,
    "The same-origin collaboration endpoint",
  );
  return {
    documentUrl: collabSocketUrl(base, COLLAB_DOCUMENT_PATH),
    presenceUrl: collabSocketUrl(base, COLLAB_PRESENCE_PATH),
    runtime: COLLAB_RUNTIME.Nitro,
  };
};
