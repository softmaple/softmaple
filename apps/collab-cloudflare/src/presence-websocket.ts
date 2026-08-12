import { normalizeDocumentId } from "./document-id";
import { isAllowedOrigin } from "./origin";

/**
 * Unlike `handleDocumentWebSocket`, this needs no auth-sniffing proxy: the
 * room id is already known from `?roomId=` at upgrade time, so the Worker
 * can route directly to `PRESENCE_ROOMS` and return its response as-is.
 */
export const handlePresenceWebSocket = (
  request: Request,
  env: Env,
): Response | Promise<Response> => {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }
  if (!isAllowedOrigin(request, env)) {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }

  const rawRoomId = new URL(request.url).searchParams.get("roomId");
  const roomId = rawRoomId === null ? null : normalizeDocumentId(rawRoomId);
  if (roomId === null) {
    return Response.json({ error: "Invalid presence room" }, { status: 400 });
  }

  return env.PRESENCE_ROOMS.getByName(roomId).fetch(request);
};
