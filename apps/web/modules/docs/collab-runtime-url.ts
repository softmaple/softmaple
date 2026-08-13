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
 */
export const buildCollabWebSocketUrl = (
  runtime: CollabRuntime,
  path: CollabWebSocketPath,
): string => {
  if (runtime === COLLAB_RUNTIME.Cloudflare) {
    const base = process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL;
    if (base) return `${base.replace(/\/+$/, "")}${path}`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
};
