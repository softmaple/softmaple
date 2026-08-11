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

export const documentRoomPath = (documentId: string): string =>
  `/__document-room/${encodeURIComponent(documentId)}`;

export const documentIdFromRoomPath = (pathname: string): string | null => {
  const prefix = "/__document-room/";
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length);
  if (encoded.length === 0 || encoded.includes("/")) return null;
  try {
    return normalizeDocumentId(decodeURIComponent(encoded));
  } catch {
    return null;
  }
};
