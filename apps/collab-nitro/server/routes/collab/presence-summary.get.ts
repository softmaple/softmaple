import { defineHandler } from "nitro";
import { summarizePresence } from "@softmaple/awareness/protocol";
import {
  authorizeHttpDocumentRequest,
  isDocumentId,
} from "../../utils/http-auth";
import { realtimePresenceStore } from "../../adapters/realtime-presence-store";
import { prisma } from "../../utils/prisma";

export default defineHandler(async (event) => {
  const ids = [
    ...new Set(
      (new URL(event.req.url).searchParams.get("documentIds") ?? "").split(","),
    ),
  ];
  if (ids.length > 24 || ids.some((id) => !isDocumentId(id)))
    return Response.json({ error: "Choose 1–24 documents" }, { status: 400 });
  const summaries = await Promise.all(
    ids.map(async (documentId) => {
      const access = await authorizeHttpDocumentRequest(event.req, documentId);
      if (access instanceof Response || access.userId === null)
        return [documentId, null];
      const document = await prisma.document.findFirst({
        where: { id: documentId, is_public: true },
        select: { id: true },
      });
      if (document === null) return [documentId, null];
      const page = await realtimePresenceStore.listMembers(documentId);
      return [documentId, summarizePresence(page.members, Date.now())];
    }),
  );
  return Response.json(
    { summaries: Object.fromEntries(summaries) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
