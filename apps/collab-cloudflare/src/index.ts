import { DocumentRoomDO } from "./document-room-do";
import { PresenceRoomDO } from "./presence-room-do";
import { handlePresenceWebSocket } from "./presence-websocket";
import { handleDocumentWebSocket } from "./websocket-proxy";

export { DocumentRoomDO, PresenceRoomDO };

export default {
  async fetch(request, env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health" || pathname === "/collab/health") {
      return Response.json({ status: "ok" });
    }
    if (pathname === "/collab/document") {
      return handleDocumentWebSocket(request, env);
    }
    if (pathname === "/collab/presence") {
      return handlePresenceWebSocket(request, env);
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
