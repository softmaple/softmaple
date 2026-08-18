const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPACT_DOCUMENT_ID_PATTERN = /^[0-9a-f]{32}$/i;

export const normalizeDocumentId = (documentId: string): string | null => {
  const unwrapped =
    documentId.startsWith("{") && documentId.endsWith("}")
      ? documentId.slice(1, -1)
      : documentId;
  const compact = unwrapped.replaceAll("-", "");
  if (!COMPACT_DOCUMENT_ID_PATTERN.test(compact)) return null;
  const normalized = compact.toLowerCase();
  const formatted = [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20),
  ].join("-");
  return DOCUMENT_ID_PATTERN.test(formatted) ? formatted : null;
};

/**
 * The routed document identity for a `/collab/document` upgrade. Both the
 * Worker route (to pick the Durable Object) and `DocumentRoomDO.fetch` (to
 * bind the room it serves) read the same `?documentId=` query parameter from
 * the same browser request, so the object can never be routed by one id and
 * bound to another.
 */
export const documentIdFromRequestUrl = (url: string): string | null => {
  const raw = new URL(url).searchParams.get("documentId");
  return raw === null ? null : normalizeDocumentId(raw);
};
