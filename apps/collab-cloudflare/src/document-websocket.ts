import { documentIdFromRequestUrl } from "./document-id";
import { isAllowedOrigin } from "./origin";

/**
 * Routes the browser upgrade straight into the document's Durable Object,
 * exactly like `handlePresenceWebSocket` does for `?roomId=`: the document id
 * is known from `?documentId=` at upgrade time, so the Worker never has to
 * terminate a socket, sniff the first `Auth` message, or relay frames. The
 * document id is an identifier, not a credential — `DocumentRoomDO` still
 * requires a protocol `Auth` message and the full server-side authorization
 * checks before any document data flows.
 */
export const handleDocumentWebSocket = (
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

  const documentId = documentIdFromRequestUrl(request.url);
  if (documentId === null) {
    return Response.json({ error: "Invalid document id" }, { status: 400 });
  }

  return env.DOCUMENT_ROOMS.getByName(documentId).fetch(request);
};
