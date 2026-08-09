import { describe, expect, it, vi } from "vitest";
import {
  createSaveCoordinator,
  deriveDocumentUiStatus,
} from "@/modules/docs/document-save-coordinator";

describe("createSaveCoordinator", () => {
  it("should keep the editor-facing save status independent of overlapping saves", async () => {
    const statuses: string[] = [];
    const coordinator = createSaveCoordinator((status) => {
      statuses.push(status);
    });

    let releaseFirst: (() => void) | undefined;
    let firstCalls = 0;
    const firstPersist = vi.fn(async () => {
      firstCalls += 1;
      if (firstCalls === 1) {
        await new Promise<"ack">((resolve) => {
          releaseFirst = () => resolve("ack");
        });
      }
      return "empty" as const;
    });
    const secondPersist = vi.fn(async () => "empty" as const);

    coordinator.requestSave(firstPersist);
    coordinator.requestSave(secondPersist);

    expect(statuses[0]).toBe("saving");
    await vi.waitFor(() => {
      expect(releaseFirst).toBeTypeOf("function");
    });
    releaseFirst?.();
    await vi.waitFor(() => {
      expect(secondPersist).toHaveBeenCalledOnce();
    });
    await vi.waitFor(() => {
      expect(statuses.at(-1)).toBe("saved");
    });
    expect(firstPersist).toHaveBeenCalled();
  });

  it("should continue persisting while the result is ack", async () => {
    const statuses: string[] = [];
    const coordinator = createSaveCoordinator((status) => {
      statuses.push(status);
    });

    let remaining = 2;
    const persist = vi.fn(async () => {
      if (remaining > 0) {
        remaining -= 1;
        return "ack" as const;
      }
      return "empty" as const;
    });

    coordinator.requestSave(persist);

    await vi.waitFor(() => {
      expect(statuses.at(-1)).toBe("saved");
    });
    expect(persist).toHaveBeenCalledTimes(3);
    expect(statuses.filter((status) => status === "saved")).toHaveLength(1);
  });

  it("should ignore a stale save completion after a newer save was queued", async () => {
    const statuses: string[] = [];
    const coordinator = createSaveCoordinator((status) => {
      statuses.push(status);
    });

    let releaseFirst: (() => void) | undefined;
    let firstCalls = 0;
    coordinator.requestSave(async () => {
      firstCalls += 1;
      if (firstCalls === 1) {
        await new Promise<"ack">((resolve) => {
          releaseFirst = () => resolve("ack");
        });
      }
      return "empty" as const;
    });
    coordinator.requestSave(async () => "empty");

    await vi.waitFor(() => {
      expect(releaseFirst).toBeTypeOf("function");
    });
    releaseFirst?.();
    await vi.waitFor(() => {
      expect(statuses.at(-1)).toBe("saved");
    });
    // Only the latest generation may publish the terminal saved status.
    expect(statuses.filter((status) => status === "saved")).toHaveLength(1);
  });

  it("should flush until persist reports empty", async () => {
    const coordinator = createSaveCoordinator(() => undefined);
    let remaining = 1;
    const persist = vi.fn(async () => {
      if (remaining > 0) {
        remaining -= 1;
        return "ack" as const;
      }
      return "empty" as const;
    });
    await coordinator.flush(persist);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("should persist an edit that arrives during the first request", async () => {
    const statuses: string[] = [];
    const coordinator = createSaveCoordinator((status) => {
      statuses.push(status);
    });
    const pending = new Set<string>(["edit-1"]);
    let releaseFirst: (() => void) | undefined;

    const persist = vi.fn(async (): Promise<"ack" | "empty"> => {
      const snapshot = [...pending];
      if (snapshot.length === 0) return "empty";
      if (snapshot.includes("edit-1") && releaseFirst === undefined) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      for (const id of snapshot) pending.delete(id);
      return pending.size === 0 ? "empty" : "ack";
    });

    coordinator.requestSave(persist);
    await vi.waitFor(() => {
      expect(releaseFirst).toBeTypeOf("function");
    });
    pending.add("edit-2");
    coordinator.requestSave(persist);
    releaseFirst?.();

    await vi.waitFor(() => {
      expect(statuses.at(-1)).toBe("saved");
    });
    expect(pending.size).toBe(0);
    expect(persist.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("deriveDocumentUiStatus", () => {
  it("should surface private save status without collaboration noise", () => {
    expect(
      deriveDocumentUiStatus({
        collaborationStatus: "disabled",
        saveStatus: "saving",
      }),
    ).toBe("saving");
    expect(
      deriveDocumentUiStatus({
        collaborationStatus: "disabled",
        saveStatus: "idle",
      }),
    ).toBe("saved");
  });

  it("should surface reconnecting collaboration without implying read-only", () => {
    expect(
      deriveDocumentUiStatus({
        collaborationStatus: "reconnecting",
        saveStatus: "saved",
      }),
    ).toBe("offline");
    expect(
      deriveDocumentUiStatus({
        collaborationStatus: "connected",
        saveStatus: "saving",
      }),
    ).toBe("saving");
  });
});
