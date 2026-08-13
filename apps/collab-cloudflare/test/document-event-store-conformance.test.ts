import type { DocumentEventBatches } from "@softmaple/collab-runtime";
import {
  createMemoryDocumentEventStore,
  documentEventStoreConformance,
} from "@softmaple/collab-runtime/testing";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { createSupabaseDocumentBackend } from "../src/supabase-backend";

type ConflictLike = {
  readonly details: {
    readonly batchIds?: ReadonlyArray<string>;
    readonly conflictType: string;
    readonly documentId: string;
    readonly eventIds?: ReadonlyArray<string>;
    readonly missingParentIds?: ReadonlyArray<string>;
  };
};

const isConflictLike = (error: unknown): error is ConflictLike =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === "DocumentEventConflictError";

const storeErrorResponse = (error: unknown): Response => {
  if (isConflictLike(error)) {
    return Response.json(
      { message: JSON.stringify({ kind: "conflict", ...error.details }) },
      { status: 400 },
    );
  }
  return Response.json(
    { message: JSON.stringify({ kind: "unavailable" }) },
    { status: 500 },
  );
};

/**
 * Simulates the two Postgres RPC functions
 * (`append_document_event_batches`, `read_document_event_page`) that
 * `createSupabaseDocumentBackend`'s real adapter calls over HTTP, backed by
 * the same reference `DocumentEventStore` used in
 * packages/collab-runtime's own conformance run and apps/collab's Prisma
 * wiring — one source of truth for what the store contract requires.
 * `supabase-backend.ts` only calls `admin.rpc(...)`, never `.from()`, so
 * these two endpoints are the entire outbound surface this port exercises.
 */
const createFetchMock =
  (backingStore: ReturnType<typeof createMemoryDocumentEventStore>) =>
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body: Record<string, unknown> = await request.json();

    if (url.pathname === "/rest/v1/rpc/append_document_event_batches") {
      const batches: DocumentEventBatches = (
        body.p_batches as ReadonlyArray<{
          readonly payload: DocumentEventBatches[number];
        }>
      ).map((entry) => entry.payload);
      try {
        const ids = await backingStore.append(
          body.p_document_id as string,
          body.p_actor_id as string,
          batches,
        );
        return Response.json(ids);
      } catch (error) {
        return storeErrorResponse(error);
      }
    }

    if (url.pathname === "/rest/v1/rpc/read_document_event_page") {
      try {
        const page = await backingStore.read(
          body.p_document_id as string,
          body.p_after_cursor as string,
        );
        return Response.json({
          batches: page.batches,
          complete: page.complete,
          nextCursor: page.nextCursor,
        });
      } catch (error) {
        return storeErrorResponse(error);
      }
    }

    throw new Error(
      `document-event-store-conformance fetch mock: unexpected request to ${url}`,
    );
  };

let backingStore: ReturnType<typeof createMemoryDocumentEventStore>;

beforeEach(() => {
  backingStore = createMemoryDocumentEventStore();
  vi.stubGlobal("fetch", createFetchMock(backingStore));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("document event store (Cloudflare/Supabase adapter)", () => {
  for (const testCase of documentEventStoreConformance(
    () => createSupabaseDocumentBackend(env).events,
  )) {
    it(testCase.name, testCase.run);
  }
});
