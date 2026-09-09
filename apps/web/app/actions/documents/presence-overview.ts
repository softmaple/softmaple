"use server";
import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/actions/authenticated";
import { resolveDocumentCollabTarget } from "@/modules/docs/collab-target.server";
import { headers } from "next/headers";

export type Overview = Readonly<
  Record<string, { readonly people: number; readonly editing: number } | null>
>;
const summarySchema = z.object({
  summaries: z.record(
    z.string(),
    z
      .object({
        people: z.number().int().nonnegative(),
        editing: z.number().int().nonnegative(),
      })
      .nullable(),
  ),
});

/** Recheck RLS, then ask only the server-resolved runtime for each document. */
export async function readPresenceOverview(
  input: readonly string[],
): Promise<Overview> {
  const parsed = z.array(z.uuid()).max(24).safeParse(input);
  if (!parsed.success || parsed.data.length === 0) return {};
  const context = await getAuthenticatedContext();
  if (!context.ok) return {};
  const { data: documents, error } = await context.data.supabase
    .from("documents")
    .select("id")
    .in("id", parsed.data)
    .eq("is_public", true);
  if (error !== null || documents === null) return {};
  const { data: session } = await context.data.supabase.auth.getSession();
  if (session.session === null) return {};
  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL;
  if (origin === undefined) return {};
  const targets = await Promise.all(
    documents.map(async ({ id }) => {
      try {
        const target = await resolveDocumentCollabTarget(id);
        const endpoint = new URL(target.presenceUrl);
        endpoint.protocol = endpoint.protocol === "wss:" ? "https:" : "http:";
        endpoint.pathname += "-summary";
        endpoint.search = "";
        return { id, endpoint: endpoint.toString() };
      } catch {
        return null;
      }
    }),
  );
  const groups = new Map<string, string[]>();
  for (const target of targets)
    if (target !== null)
      groups.set(target.endpoint, [
        ...(groups.get(target.endpoint) ?? []),
        target.id,
      ]);
  const results = await Promise.all(
    [...groups].map(async ([endpoint, ids]): Promise<Overview> => {
      const unavailable = Object.fromEntries(ids.map((id) => [id, null]));
      try {
        const url = new URL(endpoint);
        url.search = new URLSearchParams({
          documentIds: ids.join(","),
          userId: context.data.user.id,
        }).toString();
        const response = await fetch(url, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.session!.access_token}`,
            Origin: origin,
          },
          signal: AbortSignal.timeout(4_000),
        });
        if (!response.ok) return unavailable;
        const body = summarySchema.safeParse(await response.json());
        return body.success
          ? Object.fromEntries(
              ids.map((id) => [id, body.data.summaries[id] ?? null]),
            )
          : unavailable;
      } catch {
        return unavailable;
      }
    }),
  );
  return Object.assign({}, ...results);
}
