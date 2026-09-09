import { normalizeDocumentId } from "./document-id";
import { isAllowedOrigin } from "./origin";

/** Bounded HTTP fanout to the owning presence objects, without joining rooms. */
export async function handlePresenceSummary(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET")
    return new Response("Method Not Allowed", { status: 405 });
  if (!isAllowedOrigin(request, env))
    return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const ids = [
    ...new Set((url.searchParams.get("documentIds") ?? "").split(",")),
  ];
  const userId = normalizeDocumentId(url.searchParams.get("userId") ?? "");
  if (
    userId === null ||
    ids.length > 24 ||
    ids.some((id) => normalizeDocumentId(id) === null)
  )
    return new Response("Invalid summary request", { status: 400 });
  const entries = await Promise.all(
    ids.map(async (id) => {
      const target = new URL(request.url);
      target.pathname = "/collab/presence-summary-room";
      target.search = new URLSearchParams({ roomId: id, userId }).toString();
      const response = await env.PRESENCE_ROOMS.getByName(id).fetch(
        new Request(target, { headers: request.headers }),
      );
      return [id, response.ok ? await response.json() : null];
    }),
  );
  return Response.json(
    { summaries: Object.fromEntries(entries) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
