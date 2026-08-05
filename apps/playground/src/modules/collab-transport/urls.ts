/**
 * Resolve collaboration WebSocket endpoints and transport mode for playground demos.
 */

import { PLAYGROUND_PORT } from "../../../playground-port";

export const COLLAB_TRANSPORT = {
  WebSocket: "websocket",
  Broadcast: "broadcast",
} as const;

export type CollabTransport =
  (typeof COLLAB_TRANSPORT)[keyof typeof COLLAB_TRANSPORT];

export interface CollabEndpoints {
  readonly transport: CollabTransport;
  readonly docWsUrl: string | null;
  readonly presenceWsUrl: string | null;
  readonly syncWsUrl: string | null;
}

export const toWebSocketOrigin = (httpOrigin: string): string => {
  const url = new URL(httpOrigin);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  }
  // Preserve existing ws:/wss: schemes as-is.
  return url.origin;
};

export const resolveCollabTransport = (
  search: string | URLSearchParams = "",
  envTransport?: string | null,
): CollabTransport => {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const fromQuery = params.get("transport");
  if (
    fromQuery === COLLAB_TRANSPORT.WebSocket ||
    fromQuery === COLLAB_TRANSPORT.Broadcast
  ) {
    return fromQuery;
  }
  if (
    envTransport === COLLAB_TRANSPORT.WebSocket ||
    envTransport === COLLAB_TRANSPORT.Broadcast
  ) {
    return envTransport;
  }
  return COLLAB_TRANSPORT.WebSocket;
};

export const buildSameOriginEndpoints = (
  httpOrigin: string,
  transport: CollabTransport,
): CollabEndpoints => {
  if (transport === COLLAB_TRANSPORT.Broadcast) {
    return {
      transport,
      docWsUrl: null,
      presenceWsUrl: null,
      syncWsUrl: null,
    };
  }
  const wsOrigin = toWebSocketOrigin(httpOrigin);
  return {
    transport,
    docWsUrl: `${wsOrigin}/api/collab-doc`,
    presenceWsUrl: `${wsOrigin}/api/presence`,
    syncWsUrl: `${wsOrigin}/api/collab-sync`,
  };
};

const broadcastEndpoints = (): CollabEndpoints => ({
  transport: COLLAB_TRANSPORT.Broadcast,
  docWsUrl: null,
  presenceWsUrl: null,
  syncWsUrl: null,
});

const pickEndpoint = (
  override: string | undefined,
  fallback: string | null,
): string | null => (override !== undefined ? override : fallback);

export const resolveBrowserCollabEndpoints = (
  options: {
    readonly search?: string;
    readonly envTransport?: string | null;
    readonly docWsUrl?: string;
    readonly presenceWsUrl?: string;
    readonly syncWsUrl?: string;
    readonly locationOrigin?: string;
  } = {},
): CollabEndpoints => {
  const transport = resolveCollabTransport(
    options.search ??
      (typeof window === "undefined" ? "" : window.location.search),
    options.envTransport,
  );
  if (transport === COLLAB_TRANSPORT.Broadcast) {
    return broadcastEndpoints();
  }

  const origin =
    options.locationOrigin ??
    (typeof window === "undefined"
      ? `http://localhost:${PLAYGROUND_PORT}`
      : window.location.origin);
  const defaults = buildSameOriginEndpoints(origin, transport);

  return {
    transport,
    docWsUrl: pickEndpoint(options.docWsUrl, defaults.docWsUrl),
    presenceWsUrl: pickEndpoint(options.presenceWsUrl, defaults.presenceWsUrl),
    syncWsUrl: pickEndpoint(options.syncWsUrl, defaults.syncWsUrl),
  };
};
