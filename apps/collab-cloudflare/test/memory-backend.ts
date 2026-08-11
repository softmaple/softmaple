// Test-only backend used by the workerd conformance suite.
import { BOOTSTRAP_EVENT_ID } from "@softmaple/block-model";
import {
  COLLAB_ACCESS_MODE,
  type CollabCredential,
  type SupportedCollabProtocolVersion,
} from "@softmaple/collab-protocol";
import {
  DOCUMENT_EVENT_CONFLICT_TYPE,
  DocumentEventAuthorizationError,
  DocumentEventConflictError,
  type DocumentAccess,
  type DocumentEventStore,
  type DocumentSession,
  type DocumentSessionEndReason,
  type DocumentSessionHooks,
} from "@softmaple/collab-runtime";

const TEST_ACTOR_ID = "00000000-0000-4000-8000-000000000002";
const TEST_ACCESS_TOKEN = "test-token";

const STORAGE_KEY = {
  authorization: "test-backend:authorization",
  events: "test-backend:events",
  sessionAuditAuthorization: "test-backend:session-audit:authorization:",
  sessionAuditEnd: "test-backend:session-audit:end:",
  sessionAuditRefresh: "test-backend:session-audit:refresh:",
  sessionAuditSequence: "test-backend:session-audit:sequence",
} as const;

interface StoredBatch {
  readonly cursor: bigint;
  readonly payload: Parameters<DocumentEventStore["append"]>[2][number];
  readonly serialized: string;
}

interface StoredAuthorizationState {
  readonly authenticatedAccessRevoked: boolean;
  readonly publicAccessEnabled: boolean;
}

export interface MemoryAuthorizeAuditEntry {
  readonly credential: CollabCredential;
  readonly documentId: string;
  readonly peerId: string;
  readonly protocolVersion: SupportedCollabProtocolVersion;
  readonly sessionId: string;
}

export interface MemoryRefreshAuditEntry {
  readonly credential: CollabCredential;
  readonly peerId: string;
  readonly session: DocumentSession;
}

export interface MemoryEndAuditEntry {
  readonly reason: DocumentSessionEndReason;
  readonly session: DocumentSession;
}

export interface MemorySessionAudit {
  readonly authorizations: ReadonlyArray<MemoryAuthorizeAuditEntry>;
  readonly refreshes: ReadonlyArray<MemoryRefreshAuditEntry>;
  readonly ends: ReadonlyArray<MemoryEndAuditEntry>;
}

const defaultAuthorizationState = (): StoredAuthorizationState => ({
  authenticatedAccessRevoked: false,
  publicAccessEnabled: true,
});

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
  state: StoredAuthorizationState,
): DocumentAccess | null => {
  if (credential.kind === "public") {
    return state.publicAccessEnabled
      ? {
          accessMode: COLLAB_ACCESS_MODE.Public,
          actorId: null,
          canWrite: false,
          role: null,
        }
      : null;
  }
  if (
    credential.token !== TEST_ACCESS_TOKEN ||
    state.authenticatedAccessRevoked
  ) {
    return null;
  }
  return {
    accessMode: COLLAB_ACCESS_MODE.Authenticated,
    actorId: TEST_ACTOR_ID,
    canWrite: true,
    role: "EDITOR",
  };
};

const authorizationState = async (
  transaction: DurableObjectTransaction,
): Promise<StoredAuthorizationState> => {
  const stored = await transaction.get<StoredAuthorizationState>(
    STORAGE_KEY.authorization,
  );
  if (stored !== undefined) return stored;
  const initial = defaultAuthorizationState();
  await transaction.put(STORAGE_KEY.authorization, initial);
  return initial;
};

const nextAuditSequence = async (
  transaction: DurableObjectTransaction,
): Promise<number> => {
  const sequence =
    ((await transaction.get<number>(STORAGE_KEY.sessionAuditSequence)) ?? 0) +
    1;
  await transaction.put(STORAGE_KEY.sessionAuditSequence, sequence);
  return sequence;
};

const appendAuthorizationAudit = async (
  storage: DurableObjectStorage,
  entry: MemoryAuthorizeAuditEntry,
): Promise<StoredAuthorizationState> =>
  storage.transaction(async (transaction) => {
    const state = await authorizationState(transaction);
    const sequence = await nextAuditSequence(transaction);
    await transaction.put(
      `${STORAGE_KEY.sessionAuditAuthorization}${sequence}`,
      entry,
    );
    return state;
  });

const appendRefreshAudit = async (
  storage: DurableObjectStorage,
  entry: MemoryRefreshAuditEntry,
): Promise<StoredAuthorizationState> =>
  storage.transaction(async (transaction) => {
    const state = await authorizationState(transaction);
    const sequence = await nextAuditSequence(transaction);
    await transaction.put(
      `${STORAGE_KEY.sessionAuditRefresh}${sequence}`,
      entry,
    );
    return state;
  });

const appendEndAudit = async (
  storage: DurableObjectStorage,
  entry: MemoryEndAuditEntry,
): Promise<void> => {
  await storage.transaction(async (transaction) => {
    const sequence = await nextAuditSequence(transaction);
    await transaction.put(`${STORAGE_KEY.sessionAuditEnd}${sequence}`, entry);
  });
};

export const setMemoryAuthenticatedAccessRevoked = async (
  storage: DurableObjectStorage,
  revoked: boolean,
): Promise<void> => {
  await storage.transaction(async (transaction) => {
    const current = await authorizationState(transaction);
    await transaction.put(STORAGE_KEY.authorization, {
      ...current,
      authenticatedAccessRevoked: revoked,
    });
  });
};

export const setMemoryPublicAccessEnabled = async (
  storage: DurableObjectStorage,
  enabled: boolean,
): Promise<void> => {
  await storage.transaction(async (transaction) => {
    const current = await authorizationState(transaction);
    await transaction.put(STORAGE_KEY.authorization, {
      ...current,
      publicAccessEnabled: enabled,
    });
  });
};

const listedAuditEntries = async <T>(
  storage: DurableObjectStorage,
  prefix: string,
): Promise<ReadonlyArray<T>> => {
  const entries = await storage.list<T>({ prefix });
  return [...entries.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
};

export const readMemorySessionAudit = async (
  storage: DurableObjectStorage,
): Promise<MemorySessionAudit> => ({
  authorizations: await listedAuditEntries<MemoryAuthorizeAuditEntry>(
    storage,
    STORAGE_KEY.sessionAuditAuthorization,
  ),
  refreshes: await listedAuditEntries<MemoryRefreshAuditEntry>(
    storage,
    STORAGE_KEY.sessionAuditRefresh,
  ),
  ends: await listedAuditEntries<MemoryEndAuditEntry>(
    storage,
    STORAGE_KEY.sessionAuditEnd,
  ),
});

export interface MemoryDocumentBackend {
  readonly events: DocumentEventStore;
  readonly sessions: DocumentSessionHooks;
}

export const createMemoryDocumentBackend = (
  documentId: string,
  storage: DurableObjectStorage,
): MemoryDocumentBackend => {
  const events: DocumentEventStore = {
    async append(requestDocumentId, actorId, batches) {
      if (requestDocumentId !== documentId || actorId !== TEST_ACTOR_ID) {
        throw new DocumentEventAuthorizationError(
          "actor no longer has document write access",
        );
      }

      return storage.transaction(async (transaction) => {
        const stored =
          (await transaction.get<ReadonlyArray<StoredBatch>>(
            STORAGE_KEY.events,
          )) ?? [];
        const batchesById = new Map(
          stored.map((entry) => [entry.payload.batchId, entry]),
        );
        const eventIds = new Set(
          stored.flatMap((entry) =>
            entry.payload.events.map((event) => event.id),
          ),
        );
        const incomingEventIds = batches.flatMap((batch) =>
          batch.events.map((event) => event.id),
        );
        if (new Set(incomingEventIds).size !== incomingEventIds.length) {
          throw new DocumentEventConflictError(
            "duplicate event IDs in incoming batches",
            {
              conflictType:
                DOCUMENT_EVENT_CONFLICT_TYPE.DuplicateIncomingEventId,
              documentId,
              eventIds: incomingEventIds,
            },
          );
        }

        const availableEventIds = new Set<string>();
        const appended: StoredBatch[] = [];
        for (const batch of batches) {
          const serialized = canonicalJson(batch);
          const existing = batchesById.get(batch.batchId);
          if (existing !== undefined) {
            if (existing.serialized !== serialized) {
              throw new DocumentEventConflictError(
                `conflicting payload for batch ${batch.batchId}`,
                {
                  batchIds: [batch.batchId],
                  conflictType:
                    DOCUMENT_EVENT_CONFLICT_TYPE.BatchPayloadConflict,
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
                conflictType:
                  DOCUMENT_EVENT_CONFLICT_TYPE.StoredEventIdConflict,
                documentId,
                eventIds: conflictingEventIds,
              },
            );
          }

          const entry: StoredBatch = {
            cursor: BigInt(stored.length + appended.length + 1),
            payload: batch,
            serialized,
          };
          appended.push(entry);
          batchesById.set(batch.batchId, entry);
          for (const event of batch.events) {
            eventIds.add(event.id);
            availableEventIds.add(event.id);
          }
        }

        if (appended.length > 0) {
          await transaction.put(STORAGE_KEY.events, [...stored, ...appended]);
        }
        return batches.map((batch) => batch.batchId);
      });
    },

    async read(requestDocumentId, afterCursor) {
      if (requestDocumentId !== documentId) {
        return { batches: [], complete: true, nextCursor: afterCursor };
      }
      const stored =
        (await storage.get<ReadonlyArray<StoredBatch>>(STORAGE_KEY.events)) ??
        [];
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
      const state = await appendAuthorizationAudit(storage, request);
      return request.documentId === documentId
        ? accessForCredential(request.credential, state)
        : null;
    },
    async refresh(request) {
      const state = await appendRefreshAudit(storage, request);
      return request.session.documentId === documentId
        ? accessForCredential(request.credential, state)
        : null;
    },
    async end(session, reason) {
      await appendEndAudit(storage, { reason, session });
    },
  };

  return { events, sessions };
};
