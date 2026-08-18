import {
  COLLAB_RUNTIME,
  type CollabRuntime,
} from "@/modules/docs/collab-runtime-routing";

export type CollabWebSocketPath = "/collab/document" | "/collab/presence";

/**
 * Builds the browser WebSocket URL for a document/presence connection given
 * a runtime decision resolved server-side. Falls back to the same-origin
 * Nitro path whenever the Cloudflare base URL isn't configured, mirroring
 * the server-side safety net in collab-runtime-routing.ts.
 *
 * `routing` carries the identifiers the Cloudflare Worker resolves a Durable
 * Object with before reading any protocol message (`?documentId=` for the
 * document room, `?roomId=` for presence). They are identifiers, not
 * credentials: authentication stays in the first protocol message, so no
 * access token ever belongs in this URL. The same-origin Nitro path — the
 * fallback below included — routes on that first message instead and keeps
 * its historical query-free URL.
 */
export const buildCollabWebSocketUrl = (
  runtime: CollabRuntime,
  path: CollabWebSocketPath,
  routing: Readonly<Record<string, string>> = {},
): string => {
  if (runtime === COLLAB_RUNTIME.Cloudflare) {
    const base = process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL;
    if (base) {
      const url = new URL(`${base.replace(/\/+$/, "")}${path}`);
      url.search = new URLSearchParams(routing).toString();
      return url.toString();
    }
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
};
