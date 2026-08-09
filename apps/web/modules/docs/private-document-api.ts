import {
  parseRichTextEventBatch,
  type RichTextEventBatch,
} from "@softmaple/block-model";

const PRIVATE_DOCUMENT_FETCH_TIMEOUT_MS = 15_000;

const historyUrl = (documentId: string, afterCursor: string): string => {
  const url = new URL("/collab/document-history", window.location.origin);
  url.searchParams.set("documentId", documentId);
  url.searchParams.set("after", afterCursor);
  return url.toString();
};

const eventsUrl = (): string =>
  new URL("/collab/document-events", window.location.origin).toString();

const mapFetchError = (error: unknown, fallback: string): Error => {
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return new Error("Document request timed out");
  }
  if (error instanceof Error) return error;
  return new Error(fallback);
};

export const loadPrivateDocumentHistory = async ({
  accessToken,
  documentId,
}: {
  readonly accessToken: string;
  readonly documentId: string;
}): Promise<ReadonlyArray<RichTextEventBatch>> => {
  const batches: RichTextEventBatch[] = [];
  let afterCursor = "0";
  try {
    for (;;) {
      const response = await fetch(historyUrl(documentId, afterCursor), {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        method: "GET",
        signal: AbortSignal.timeout(PRIVATE_DOCUMENT_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Could not load document history (${response.status})`);
      }
      const payload = (await response.json()) as {
        readonly batches: unknown;
        readonly nextCursor: unknown;
        readonly complete: unknown;
      };
      if (
        !Array.isArray(payload.batches) ||
        typeof payload.complete !== "boolean"
      ) {
        throw new Error("Document history response is invalid");
      }
      for (const batch of payload.batches) {
        batches.push(parseRichTextEventBatch(batch));
      }
      if (payload.complete) break;
      if (
        typeof payload.nextCursor !== "string" ||
        payload.nextCursor === afterCursor
      ) {
        throw new Error("Document history pagination did not advance");
      }
      afterCursor = payload.nextCursor;
    }
  } catch (error) {
    throw mapFetchError(error, "Could not load the private document");
  }
  return batches;
};

export const persistPrivateDocumentEvents = async ({
  accessToken,
  batches,
  documentId,
}: {
  readonly accessToken: string;
  readonly batches: ReadonlyArray<RichTextEventBatch>;
  readonly documentId: string;
}): Promise<ReadonlyArray<string>> => {
  if (batches.length === 0) return [];
  try {
    const response = await fetch(eventsUrl(), {
      body: JSON.stringify({ batches, documentId }),
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(PRIVATE_DOCUMENT_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Could not save document (${response.status})`);
    }
    const payload = (await response.json()) as { readonly batchIds?: unknown };
    if (!Array.isArray(payload.batchIds)) {
      throw new Error("Save response is invalid");
    }
    return payload.batchIds.filter(
      (batchId): batchId is string => typeof batchId === "string",
    );
  } catch (error) {
    throw mapFetchError(error, "Could not save the private document");
  }
};
