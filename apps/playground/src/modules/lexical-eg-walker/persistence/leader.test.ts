import { describe, expect, it } from "vitest";
import {
  createLeaderElection,
  type ExclusiveLockRequestOptions,
  getPersistenceLeaderLockName,
  type LockHandleLike,
  type LockManagerLike,
} from "./leader";

interface PendingRequest {
  readonly callback: (lock: LockHandleLike) => Promise<void> | void;
  readonly name: string;
  readonly options: ExclusiveLockRequestOptions;
  readonly reject: (error: Error) => void;
  readonly resolve: () => void;
}

class FakeLockManager implements LockManagerLike {
  private readonly activeNames = new Set<string>();
  private readonly requests: PendingRequest[] = [];

  request(
    name: string,
    options: ExclusiveLockRequestOptions,
    callback: (lock: LockHandleLike) => Promise<void> | void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const request = { name, options, callback, resolve, reject };
      options.signal.addEventListener(
        "abort",
        () => {
          const index = this.requests.indexOf(request);
          if (index < 0) return;
          this.requests.splice(index, 1);
          const error = new Error("Lock request aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
      this.requests.push(request);
      this.drain(name);
    });
  }

  private drain(name: string): void {
    if (this.activeNames.has(name)) return;
    const index = this.requests.findIndex((request) => request.name === name);
    if (index < 0) return;
    const [request] = this.requests.splice(index, 1);
    if (!request) return;

    this.activeNames.add(name);
    Promise.resolve(
      request.callback({ name, mode: request.options.mode }),
    ).then(
      () => {
        this.activeNames.delete(name);
        request.resolve();
        this.drain(name);
      },
      (error: unknown) => {
        this.activeNames.delete(name);
        request.reject(
          error instanceof Error ? error : new Error("Lock callback failed"),
        );
        this.drain(name);
      },
    );
  }
}

const tick = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("persistence Web Locks leader election", () => {
  it("elects one leader and promotes a waiter when it stops", async () => {
    const locks = new FakeLockManager();
    const first = createLeaderElection({
      roomId: "room-a",
      lockManager: locks,
    });
    const second = createLeaderElection({
      roomId: "room-a",
      lockManager: locks,
    });

    first.start();
    second.start();
    expect(first.getSnapshot().status).toBe("leader");
    expect(second.getSnapshot().status).toBe("waiting");

    await first.stop();
    await tick();
    expect(second.getSnapshot().status).toBe("leader");

    await second.stop();
  });

  it("uses a room-scoped lock name", () => {
    expect(getPersistenceLeaderLockName("a/b")).toBe(
      "softmaple:lexical-eg-walker:v1:persistence:a%2Fb",
    );
  });

  it("reports an unsupported fallback without claiming leadership", async () => {
    const election = createLeaderElection({
      roomId: "room-a",
      lockManager: null,
    });
    election.start();

    expect(election.getSnapshot()).toEqual({
      status: "unsupported",
      isLeader: false,
      errorMessage: null,
    });
    await election.stop();
  });

  it("cancels a queued request when stopped", async () => {
    const locks = new FakeLockManager();
    const leader = createLeaderElection({
      roomId: "room-a",
      lockManager: locks,
    });
    const waiter = createLeaderElection({
      roomId: "room-a",
      lockManager: locks,
    });
    leader.start();
    waiter.start();

    await waiter.stop();
    await leader.stop();
    await tick();

    expect(waiter.getSnapshot().status).toBe("stopped");
  });

  it("surfaces lock manager failures", async () => {
    const lockManager: LockManagerLike = {
      request: async () => {
        throw new Error("locks unavailable");
      },
    };
    const election = createLeaderElection({ roomId: "room-a", lockManager });
    election.start();
    await tick();

    expect(election.getSnapshot()).toEqual({
      status: "error",
      isLeader: false,
      errorMessage: "locks unavailable",
    });
  });
});
