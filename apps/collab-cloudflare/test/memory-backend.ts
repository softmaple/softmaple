// Test-only backend used by the workerd conformance suite.
import { BOOTSTRAP_EVENT_ID } from "@softmaple/block-model";
import {
  COLLAB_ACCESS_MODE,
  type CollabCredential,
} from "@softmaple/collab-protocol";
import {
  DOCUMENT_EVENT_CONFLICT_TYPE,
  DocumentEventAuthorizationError,
  DocumentEventConflictError,
  type DocumentAccess,
  type DocumentEventStore,
  type DocumentSessionHooks,
} from "@softmaple/collab-runtime";

const TEST_ACTOR_ID = "00000000-0000-4000-8000-000000000002";
const TEST_ACCESS_TOKEN = "test-token";

interface StoredBatch {
  readonly cursor: bigint;
  readonly payload: Parameters<DocumentEventStore["append"]>[2][number];
  readonly serialized: string;
}

const canonicalJson = (value: unknown): string => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("event batch contains a non-JSON value");
};

const accessForCredential = (
  credential: CollabCredential,
): DocumentAccess | null => {
  if (credential.kind === "public") {
    return {
      accessMode: COLLAB_ACCESS_MODE.Public,
      actorId: null,
      canWrite: false,
      role: null,
    };
  }
  if (credential.token !== TEST_ACCESS_TOKEN) return null;
  return {
    accessMode: COLLAB_ACCESS_MODE.Authenticated,
    actorId: TEST_ACTOR_ID,
    canWrite: true,
    role: "EDITOR",
  };
};

export interface MemoryDocumentBackend {
  readonly events: DocumentEventStore;
  readonly sessions: DocumentSessionHooks;
}

export const createMemoryDocumentBackend = (
  documentId: string,
): MemoryDocumentBackend => {
  const stored: StoredBatch[] = [];
  const batchesById = new Map<string, StoredBatch>();
  const eventIds = new Set<string>();

  const events: DocumentEventStore = {
    async append(requestDocumentId, actorId, batches) {
      if (requestDocumentId !== documentId || actorId !== TEST_ACTOR_ID) {
        throw new DocumentEventAuthorizationError(
          "actor no longer has document write access",
        );
      }

      const incomingEventIds = batches.flatMap((batch) =>
        batch.events.map((event) => event.id),
      );
      if (new Set(incomingEventIds).size !== incomingEventIds.length) {
        throw new DocumentEventConflictError(
          "duplicate event IDs in incoming batches",
          {
            conflictType: DOCUMENT_EVENT_CONFLICT_TYPE.DuplicateIncomingEventId,
            documentId,
            eventIds: incomingEventIds,
          },
        );
      }

      const availableEventIds = new Set<string>();
      for (const batch of batches) {
        const serialized = canonicalJson(batch);
        const existing = batchesById.get(batch.batchId);
        if (existing !== undefined) {
          if (existing.serialized !== serialized) {
            throw new DocumentEventConflictError(
              `conflicting payload for batch ${batch.batchId}`,
              {
                batchIds: [batch.batchId],
                conflictType: DOCUMENT_EVENT_CONFLICT_TYPE.BatchPayloadConflict,
                documentId,
              },
            );
          }
          for (const event of batch.events) availableEventIds.add(event.id);
          continue;
        }

        const seenInBatch = new Set<string>();
        const requiredParents = new Set<string>();
        for (const parentId of batch.parentVersion) {
          if (
            parentId !== BOOTSTRAP_EVENT_ID &&
            !availableEventIds.has(parentId)
          ) {
            requiredParents.add(parentId);
          }
        }
        for (const event of batch.events) {
          for (const parentId of event.parentVersion) {
            if (
              parentId !== BOOTSTRAP_EVENT_ID &&
              !availableEventIds.has(parentId) &&
              !seenInBatch.has(parentId)
            ) {
              requiredParents.add(parentId);
            }
          }
          seenInBatch.add(event.id);
        }

        const missingParentIds = [...requiredParents]
          .filter((eventId) => !eventIds.has(eventId))
          .sort();
        if (missingParentIds.length > 0) {
          throw new DocumentEventConflictError(
            "event batch references document history that has not been stored",
            {
              batchIds: [batch.batchId],
              conflictType: DOCUMENT_EVENT_CONFLICT_TYPE.MissingParentHistory,
              documentId,
              missingParentIds,
            },
          );
        }

        const conflictingEventIds = batch.events
          .map((event) => event.id)
          .filter((eventId) => eventIds.has(eventId));
        if (conflictingEventIds.length > 0) {
          throw new DocumentEventConflictError(
            "event IDs conflict with stored document history",
            {
              batchIds: [batch.batchId],
              conflictType: DOCUMENT_EVENT_CONFLICT_TYPE.StoredEventIdConflict,
              documentId,
              eventIds: conflictingEventIds,
            },
          );
        }

        const entry: StoredBatch = {
          cursor: BigInt(stored.length + 1),
          payload: batch,
          serialized,
        };
        stored.push(entry);
        batchesById.set(batch.batchId, entry);
        for (const event of batch.events) {
          eventIds.add(event.id);
          availableEventIds.add(event.id);
        }
      }

      return batches.map((batch) => batch.batchId);
    },

    async read(requestDocumentId, afterCursor) {
      if (requestDocumentId !== documentId) {
        return { batches: [], complete: true, nextCursor: afterCursor };
      }
      const cursor = BigInt(afterCursor);
      const remaining = stored.filter((entry) => entry.cursor > cursor);
      const page = remaining.slice(0, 100);
      return {
        batches: page.map((entry) => entry.payload),
        complete: remaining.length <= 100,
        nextCursor: page.at(-1)?.cursor.toString() ?? afterCursor,
      };
    },
  };

  const sessions: DocumentSessionHooks = {
    async authorize(request) {
      return request.documentId === documentId
        ? accessForCredential(request.credential)
        : null;
    },
    async refresh(request) {
      return request.session.documentId === documentId
        ? accessForCredential(request.credential)
        : null;
    },
  };

  return { events, sessions };
};
