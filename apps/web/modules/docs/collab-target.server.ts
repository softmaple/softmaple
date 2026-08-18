import { headers } from "next/headers";
import {
  readCloudflareCollabBaseUrl,
  resolveCollabRuntime,
} from "@/modules/docs/collab-runtime-routing";
import {
  resolveCollabTarget,
  sameOriginCollabBaseUrl,
  type CollabTarget,
} from "@/modules/docs/collab-target";

/**
 * Server-side authority for a document's collaboration connection: it picks
 * the runtime that owns the document, then resolves that runtime's endpoints
 * in one step. The browser receives the result and connects to exactly it.
 *
 * A missing or malformed Cloudflare endpoint throws here, while the page is
 * still rendering, instead of degrading into a Nitro connection for a document
 * Cloudflare owns. Server-side imports only (`next/headers`).
 */
export const resolveDocumentCollabTarget = async (
  documentId: string,
): Promise<CollabTarget> => {
  const requestHeaders = await headers();
  return resolveCollabTarget({
    cloudflareBaseUrl: readCloudflareCollabBaseUrl(),
    documentId,
    runtime: resolveCollabRuntime(documentId),
    sameOriginBaseUrl: sameOriginCollabBaseUrl({
      forwardedHost: requestHeaders.get("x-forwarded-host"),
      forwardedProto: requestHeaders.get("x-forwarded-proto"),
      host: requestHeaders.get("host"),
    }),
  });
};
