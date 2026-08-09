import { parseRichTextEventBatch } from "@softmaple/block-model";
import { defineHandler } from "nitro";
import { authorizeHttpDocumentRequest } from "../../utils/http-auth";
import {
  appendEventBatches,
  EventAuthorizationError,
  EventConflictError,
  isRetryableEventConflict,
} from "../../utils/event-store";

export default defineHandler(async (event) => {
  const request = event.req;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const documentId =
    typeof record.documentId === "string" ? record.documentId : "";
  const access = await authorizeHttpDocumentRequest(request, documentId);
  if (access instanceof Response) return access;

  if (!access.canWrite || access.userId === null) {
    return Response.json({ error: "Write access required" }, { status: 403 });
  }

  if (!Array.isArray(record.batches)) {
    return Response.json(
      { error: "batches must be an array" },
      { status: 400 },
    );
  }

  let batches;
  try {
    batches = record.batches.map((batch) => parseRichTextEventBatch(batch));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid event batch payload",
      },
      { status: 400 },
    );
  }

  if (batches.length === 0) {
    return Response.json({ batchIds: [] });
  }

  try {
    const batchIds = await appendEventBatches(
      access.documentId,
      access.userId,
      batches,
    );
    return Response.json({ batchIds });
  } catch (error) {
    if (error instanceof EventAuthorizationError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof EventConflictError) {
      return Response.json(
        {
          error: error.message,
          conflictType: error.details.conflictType,
          retryable: isRetryableEventConflict(error),
        },
        { status: 409 },
      );
    }
    throw error;
  }
});
