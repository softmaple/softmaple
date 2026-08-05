import { BOOTSTRAP_BLOCK_ID, createBlockReplica } from "@softmaple/block-model";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPersistenceCoordinator,
  type PersistenceCoordinator,
  type PersistenceCoordinatorSnapshot,
} from "./persistence/coordinator";
import { WireBatchSchema } from "./persistence/schema";
import { parsePersistenceBatch, useLexicalRoom } from "./useLexicalRoom";

vi.mock("./persistence/coordinator", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./persistence/coordinator")>();
  return { ...actual, createPersistenceCoordinator: vi.fn() };
});

const snapshot: PersistenceCoordinatorSnapshot = {
  mode: "persistent",
  durability: "saved",
  leader: { status: "leader", isLeader: true, errorMessage: null },
  pendingBatchIds: [],
  durableBatchIds: [],
  storageBytes: 0,
  failureReason: null,
  errorMessage: null,
  syncConnectionState: "connected",
};

const createCoordinator = (): PersistenceCoordinator => ({
  publishBatch: vi.fn(() => true),
  requestRepair: vi.fn(() => "repair"),
  flushPending: vi.fn(async () => undefined),
  getKnownBatches: vi.fn(() => []),
  getSnapshot: vi.fn(() => snapshot),
  subscribeBatches: vi.fn(() => () => undefined),
  subscribeState: vi.fn(() => () => undefined),
  subscribeErrors: vi.fn(() => () => undefined),
  close: vi.fn(async () => undefined),
});

const deferred = <T>() => {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
};

afterEach(() => {
  vi.mocked(createPersistenceCoordinator).mockReset();
});

describe("lexical room persistence batches", () => {
  it("accepts block-model batches and rejects structural-only envelopes", () => {
    const replica = createBlockReplica("peer-a");
    const validBatch = replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "hello");
    });
    const structuralOnlyBatch = WireBatchSchema.parse({
      schemaVersion: 1,
      batchId: "structural-only",
      parentVersion: [],
      events: [
        {
          schemaVersion: 1,
          id: "structural-only:event",
          parentVersion: [],
        },
      ],
    });

    expect(validBatch).not.toBeNull();
    expect(parsePersistenceBatch(validBatch)).toEqual(validBatch);
    expect(() => parsePersistenceBatch(structuralOnlyBatch)).toThrow();
  });

  it("hides the previous room while the next room initializes", async () => {
    const roomA = deferred<PersistenceCoordinator>();
    const roomB = deferred<PersistenceCoordinator>();
    vi.mocked(createPersistenceCoordinator).mockImplementation((options) =>
      options.roomId === "room-a" ? roomA.promise : roomB.promise,
    );
    const { result, rerender } = renderHook(
      ({ roomId }) => useLexicalRoom(roomId, "peer-a"),
      { initialProps: { roomId: "room-a" } },
    );

    await act(async () => roomA.resolve(createCoordinator()));
    await waitFor(() => expect(result.current.replica).not.toBeNull());
    const previousReplica = result.current.replica;

    rerender({ roomId: "room-b" });

    expect(result.current.replica).toBeNull();
    expect(result.current.persistence).toBeNull();
    expect(result.current.error).toBeNull();

    await act(async () => roomB.resolve(createCoordinator()));
    await waitFor(() => expect(result.current.replica).not.toBeNull());
    expect(result.current.replica).not.toBe(previousReplica);
  });
});
