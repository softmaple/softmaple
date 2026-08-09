import {
  parseRichTextEventBatch,
  type RichTextEventBatch,
} from "@softmaple/block-model";

const historyUrl = (documentId: string, afterCursor: string): string => {
  const url = new URL("/collab/document-history", window.location.origin);
  url.searchParams.set("documentId", documentId);
  url.searchParams.set("after", afterCursor);
  return url.toString();
};

const eventsUrl = (): string =>
  new URL("/collab/document-events", window.location.origin).toString();

export const loadPrivateDocumentHistory = async ({
  accessToken,
  documentId,
}: {
  readonly accessToken: string;
  readonly documentId: string;
}): Promise<ReadonlyArray<RichTextEventBatch>> => {
  const batches: RichTextEventBatch[] = [];
  let afterCursor = "0";
  for (;;) {
    const response = await fetch(historyUrl(documentId, afterCursor), {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
    });
    if (!response.ok) {
      throw new Error(`Could not load document history (${response.status})`);
    }
    const payload = (await response.json()) as {
      readonly batches: unknown;
      readonly nextCursor: string;
      readonly complete: boolean;
    };
    if (!Array.isArray(payload.batches)) {
      throw new Error("Document history response is invalid");
    }
    for (const batch of payload.batches) {
      batches.push(parseRichTextEventBatch(batch));
    }
    if (payload.complete) break;
    afterCursor = payload.nextCursor;
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
  const response = await fetch(eventsUrl(), {
    body: JSON.stringify({ batches, documentId }),
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    method: "POST",
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
};
