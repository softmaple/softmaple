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
    const firstPersist = vi.fn(
      () =>
        new Promise<"ack">((resolve) => {
          releaseFirst = () => resolve("ack");
        }),
    );
    const secondPersist = vi.fn(async () => "ack" as const);

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
    expect(firstPersist).toHaveBeenCalledOnce();
  });

  it("should ignore a stale save completion after a newer save was queued", async () => {
    const statuses: string[] = [];
    const coordinator = createSaveCoordinator((status) => {
      statuses.push(status);
    });

    let releaseFirst: (() => void) | undefined;
    coordinator.requestSave(
      () =>
        new Promise<"ack">((resolve) => {
          releaseFirst = () => resolve("ack");
        }),
    );
    coordinator.requestSave(async () => "ack");

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

  it("should flush queued saves before resolving", async () => {
    const coordinator = createSaveCoordinator(() => undefined);
    const persist = vi.fn(async () => "empty" as const);
    await coordinator.flush(persist);
    expect(persist).toHaveBeenCalledOnce();
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
