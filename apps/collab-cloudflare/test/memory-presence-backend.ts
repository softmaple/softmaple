// Test-only presence backend used by the workerd conformance suite.
import type { CollabCredential } from "@softmaple/collab-protocol";
import type {
  PresenceIdentity,
  PresenceSession,
  PresenceSessionEndReason,
  PresenceSessionHooks,
} from "@softmaple/collab-runtime";
import type { PresenceBackend } from "../src/supabase-presence-backend";

const TEST_ACTOR_ID = "00000000-0000-4000-8000-000000000002";
const TEST_ACCESS_TOKEN = "test-token";
const TEST_IDENTITY: PresenceIdentity = {
  name: "Ada Lovelace",
  userId: TEST_ACTOR_ID,
};

const STORAGE_KEY = {
  authorization: "test-presence-backend:authorization",
  sessionAuditAuthorization:
    "test-presence-backend:session-audit:authorization:",
  sessionAuditEnd: "test-presence-backend:session-audit:end:",
  sessionAuditRefresh: "test-presence-backend:session-audit:refresh:",
  sessionAuditSequence: "test-presence-backend:session-audit:sequence",
} as const;

interface StoredAuthorizationState {
  readonly revoked: boolean;
}

export interface MemoryPresenceAuthorizeAuditEntry {
  readonly connectionId: string;
  readonly credential: CollabCredential;
  readonly roomId: string;
  readonly userId: string;
}

export interface MemoryPresenceRefreshAuditEntry {
  readonly connectionId: string;
  readonly credential: CollabCredential;
  readonly session: PresenceSession;
}

export interface MemoryPresenceEndAuditEntry {
  readonly reason: PresenceSessionEndReason;
  readonly session: PresenceSession;
}

export interface MemoryPresenceSessionAudit {
  readonly authorizations: ReadonlyArray<MemoryPresenceAuthorizeAuditEntry>;
  readonly ends: ReadonlyArray<MemoryPresenceEndAuditEntry>;
  readonly refreshes: ReadonlyArray<MemoryPresenceRefreshAuditEntry>;
}

const defaultAuthorizationState = (): StoredAuthorizationState => ({
  revoked: false,
});

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
  entry: MemoryPresenceAuthorizeAuditEntry,
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
  entry: MemoryPresenceRefreshAuditEntry,
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
  entry: MemoryPresenceEndAuditEntry,
): Promise<void> => {
  await storage.transaction(async (transaction) => {
    const sequence = await nextAuditSequence(transaction);
    await transaction.put(`${STORAGE_KEY.sessionAuditEnd}${sequence}`, entry);
  });
};

export const setMemoryPresenceAccessRevoked = async (
  storage: DurableObjectStorage,
  revoked: boolean,
): Promise<void> => {
  await storage.transaction(async (transaction) => {
    await transaction.put(STORAGE_KEY.authorization, { revoked });
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

export const readMemoryPresenceSessionAudit = async (
  storage: DurableObjectStorage,
): Promise<MemoryPresenceSessionAudit> => ({
  authorizations: await listedAuditEntries<MemoryPresenceAuthorizeAuditEntry>(
    storage,
    STORAGE_KEY.sessionAuditAuthorization,
  ),
  ends: await listedAuditEntries<MemoryPresenceEndAuditEntry>(
    storage,
    STORAGE_KEY.sessionAuditEnd,
  ),
  refreshes: await listedAuditEntries<MemoryPresenceRefreshAuditEntry>(
    storage,
    STORAGE_KEY.sessionAuditRefresh,
  ),
});

const identityForCredential = (
  credential: CollabCredential,
  claimedUserId: string,
  state: StoredAuthorizationState,
): PresenceIdentity | null => {
  if (state.revoked || credential.kind !== "access-token") return null;
  if (credential.token !== TEST_ACCESS_TOKEN) return null;
  if (claimedUserId !== TEST_ACTOR_ID) return null;
  return TEST_IDENTITY;
};

export const createMemoryPresenceBackend = (
  roomId: string,
  storage: DurableObjectStorage,
): PresenceBackend => {
  const sessions: PresenceSessionHooks = {
    async authorize(request) {
      const state = await appendAuthorizationAudit(storage, {
        connectionId: request.connectionId,
        credential: request.credential,
        roomId: request.roomId,
        userId: request.userId,
      });
      if (request.roomId !== roomId) return null;
      return identityForCredential(request.credential, request.userId, state);
    },
    async refresh(request) {
      const state = await appendRefreshAudit(storage, {
        connectionId: request.connectionId,
        credential: request.credential,
        session: request.session,
      });
      if (request.session.roomId !== roomId) return null;
      return identityForCredential(
        request.credential,
        request.session.identity.userId,
        state,
      );
    },
    async end(session, reason) {
      await appendEndAudit(storage, { reason, session });
    },
  };

  return { sessions };
};
