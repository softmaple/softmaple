import { defineHandler } from "nitro";
import { authorizeHttpDocumentRequest } from "../../utils/http-auth";
import { readEventPage } from "../../utils/event-store";

export default defineHandler(async (event) => {
  const request = event.req;
  const url = new URL(request.url);
  const documentId = url.searchParams.get("documentId") ?? "";
  const afterCursor = url.searchParams.get("after") ?? "0";

  const access = await authorizeHttpDocumentRequest(request, documentId);
  if (access instanceof Response) return access;

  if (!/^\d+$/.test(afterCursor)) {
    return Response.json({ error: "Invalid cursor" }, { status: 400 });
  }

  const page = await readEventPage(access.documentId, afterCursor);
  return Response.json({
    batches: page.batches,
    nextCursor: page.nextCursor,
    complete: page.complete,
  });
});
