import type { CollabCredential } from "@softmaple/collab-protocol";
import { authorizeDocument, type DocumentAccess } from "./auth";
import { authenticateBrowserOrigin } from "./origin-auth";

const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isDocumentId = (value: string): boolean =>
  DOCUMENT_ID_PATTERN.test(value);

export const credentialFromAuthorizationHeader = (
  header: string | null,
): CollabCredential | null => {
  if (header === null) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (match === null) return null;
  return { kind: "access-token", token: match[1]! };
};

/**
 * Browser fetches to same-origin `/collab/*` HTTP routes sometimes omit Origin
 * on GET. Accept either a valid Origin or a same-origin Sec-Fetch-Site signal.
 */
export const authenticateHttpBrowserRequest = (request: Request): void => {
  try {
    authenticateBrowserOrigin(request);
    return;
  } catch {
    const secFetchSite = request.headers.get("sec-fetch-site");
    if (secFetchSite === "same-origin" || secFetchSite === "same-site") {
      return;
    }
    throw new Response("Forbidden", { status: 403 });
  }
};

export const authorizeHttpDocumentRequest = async (
  request: Request,
  documentId: string,
): Promise<DocumentAccess | Response> => {
  try {
    authenticateHttpBrowserRequest(request);
  } catch {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }

  if (!isDocumentId(documentId)) {
    return Response.json({ error: "Invalid document id" }, { status: 400 });
  }

  const credential = credentialFromAuthorizationHeader(
    request.headers.get("authorization"),
  );
  if (credential === null) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const access = await authorizeDocument(credential, documentId);
  if (access === null) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return access;
};
