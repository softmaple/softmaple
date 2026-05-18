import {
  computeTextareaOperations,
  type TextareaOperation,
  type UseTextareaCollaborationResult,
} from "@softmaple/awareness/bindings/textarea";
import { POSITION_OPERATION_TYPE } from "@softmaple/awareness/mapping";
import { EgWalkerReplica } from "@softmaple/eg-walker";
import { describe, expect, it, vi } from "vitest";
import { syncLocalOperationsToRemote } from "../modules/collaborative-editor/use-collaborative-editor";

const mockCollaboration = (): UseTextareaCollaborationResult & {
  readonly applyRemoteOperations: ReturnType<typeof vi.fn>;
} => ({
  applyRemoteOperations:
    vi.fn<(operations: readonly TextareaOperation[]) => void>(),
  getDocumentSnapshot: vi.fn(() => ""),
  getSelection: vi.fn(() => null),
  restoreSelection: vi.fn(),
  mapSelectionThroughOperations: vi.fn((selection) => selection),
  isComposing: vi.fn(() => false),
});

const seed = (
  local: EgWalkerReplica,
  remote: EgWalkerReplica,
  value: string,
): void => {
  const ops = computeTextareaOperations(local.getText(), value);
  for (const op of ops) {
    if (op.type === POSITION_OPERATION_TYPE.Delete) {
      local.delete(op.index, op.length);
    } else {
      local.insert(op.index, op.text);
    }
  }
  for (const event of local.exportEventGraph()) {
    remote.applyRemoteEvent(event);
  }
};

describe("syncLocalOperationsToRemote", () => {
  it("does nothing for an empty operation batch", async () => {
    const local = new EgWalkerReplica("local");
    const remote = new EgWalkerReplica("remote");
    const remoteCollaboration = mockCollaboration();

    await syncLocalOperationsToRemote([], {
      localReplica: local,
      remoteReplica: remote,
      remoteCollaboration,
      remoteLabel: "remote",
    });

    expect(remoteCollaboration.applyRemoteOperations).not.toHaveBeenCalled();
    expect(local.getText()).toBe("");
    expect(remote.getText()).toBe("");
  });

  it("syncs pure insertions between actual replicas", async () => {
    const local = new EgWalkerReplica("local");
    const remote = new EgWalkerReplica("remote");
    const remoteCollaboration = mockCollaboration();

    await syncLocalOperationsToRemote(
      [
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 0,
          length: 5,
          text: "Hello",
        },
      ],
      {
        localReplica: local,
        remoteReplica: remote,
        remoteCollaboration,
        remoteLabel: "remote",
      },
    );

    expect(local.getText()).toBe("Hello");
    expect(remote.getText()).toBe("Hello");
    expect(remoteCollaboration.applyRemoteOperations).toHaveBeenCalledTimes(1);
    const [forwarded] =
      remoteCollaboration.applyRemoteOperations.mock.calls[0] ?? [];
    expect(forwarded).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 0,
        length: 5,
        text: "Hello",
      },
    ]);
  });

  it("syncs replacements with net length changes", async () => {
    const local = new EgWalkerReplica("local");
    const remote = new EgWalkerReplica("remote");
    const remoteCollaboration = mockCollaboration();
    seed(local, remote, "abcXYZdef");

    await syncLocalOperationsToRemote(
      computeTextareaOperations("abcXYZdef", "abc12345def"),
      {
        localReplica: local,
        remoteReplica: remote,
        remoteCollaboration,
        remoteLabel: "remote",
      },
    );

    expect(local.getText()).toBe("abc12345def");
    expect(remote.getText()).toBe("abc12345def");
  });

  it("does not propagate errors when a remote apply throws", async () => {
    const local = new EgWalkerReplica("local");
    const remote = new EgWalkerReplica("remote");
    const remoteCollaboration = mockCollaboration();
    seed(local, remote, "abcXYZdef");

    // Replace directly rather than via `vi.spyOn`: throwing inside the
    // mocked impl propagates through `await` and is swallowed by the
    // sync function's `try`/`catch`. We assert only the contract the
    // route depends on — the function resolves and does not blow up
    // the caller — not the specific logging side effect, which can
    // shift between vitest console-intercept versions.
    const originalApply = remote.applyRemoteEvent.bind(remote);
    let applyCallCount = 0;
    remote.applyRemoteEvent = () => {
      applyCallCount++;
      throw new Error("sync failed");
    };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await expect(
        syncLocalOperationsToRemote(
          computeTextareaOperations("abcXYZdef", "abc12345def"),
          {
            localReplica: local,
            remoteReplica: remote,
            remoteCollaboration,
            remoteLabel: "remote",
          },
        ),
      ).resolves.toBeUndefined();
    } finally {
      remote.applyRemoteEvent = originalApply;
      consoleError.mockRestore();
    }

    expect(applyCallCount).toBeGreaterThan(0);
    // The walk aborted on the first throw before any remote ops
    // integrated, so the binding receives an empty batch.
    const [forwarded] = remoteCollaboration.applyRemoteOperations.mock
      .calls[0] ?? [[]];
    expect(forwarded).toEqual([]);
  });

  it("forwards no operations to the remote adapter when remote events buffer instead of integrating", async () => {
    const local = new EgWalkerReplica("local");
    const remote = new EgWalkerReplica("remote");
    const remoteCollaboration = mockCollaboration();
    // Seed only the local side so the remote will buffer the produced events
    // until their parents arrive.
    const initialOps = computeTextareaOperations("", "abcXYZdef");
    for (const op of initialOps) {
      if (op.type === POSITION_OPERATION_TYPE.Delete) {
        local.delete(op.index, op.length);
      } else {
        local.insert(op.index, op.text);
      }
    }

    await syncLocalOperationsToRemote(
      computeTextareaOperations("abcXYZdef", "abc12345def"),
      {
        localReplica: local,
        remoteReplica: remote,
        remoteCollaboration,
        remoteLabel: "remote",
      },
    );

    expect(remote.getText()).toBe("");
    expect(remote.getPendingRemoteCount()).toBeGreaterThan(0);
    const [forwarded] = remoteCollaboration.applyRemoteOperations.mock
      .calls[0] ?? [[]];
    expect(forwarded).toEqual([]);
  });

  it("forwards no visible operations when the integrated remote event is a no-op", async () => {
    const seedReplica = new EgWalkerReplica("seed");
    seedReplica.insert(0, "abcd");
    const [seedEvent] = seedReplica.exportEventGraph();
    if (!seedEvent) throw new Error("expected one seed event");

    const local = new EgWalkerReplica("local");
    const remote = new EgWalkerReplica("remote");
    local.applyRemoteEvent(seedEvent);
    remote.applyRemoteEvent(seedEvent);
    // Pre-emptively delete the same range on the remote so the local
    // delete will integrate as a visible no-op.
    remote.delete(1, 2);
    const remoteCollaboration = mockCollaboration();

    await syncLocalOperationsToRemote(computeTextareaOperations("abcd", "ad"), {
      localReplica: local,
      remoteReplica: remote,
      remoteCollaboration,
      remoteLabel: "remote",
    });

    expect(local.getText()).toBe("ad");
    expect(remote.getText()).toBe("ad");
    const [forwarded] = remoteCollaboration.applyRemoteOperations.mock
      .calls[0] ?? [[]];
    expect(forwarded).toEqual([]);
  });

  it("tolerates a null remoteCollaboration (binding not yet mounted)", async () => {
    const local = new EgWalkerReplica("local");
    const remote = new EgWalkerReplica("remote");

    await expect(
      syncLocalOperationsToRemote(
        [
          {
            type: POSITION_OPERATION_TYPE.Insert,
            index: 0,
            length: 1,
            text: "x",
          },
        ],
        {
          localReplica: local,
          remoteReplica: remote,
          remoteCollaboration: null,
          remoteLabel: "remote",
        },
      ),
    ).resolves.toBeUndefined();
    expect(local.getText()).toBe("x");
    expect(remote.getText()).toBe("x");
  });
});
