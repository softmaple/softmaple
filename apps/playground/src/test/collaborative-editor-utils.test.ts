import { EgWalkerReplica } from "@softmaple/eg-walker";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  computeLocalEdit,
  runReplicaChange,
  type TextareaSelection,
  type UseTextareaSelectionSyncResult,
} from "../modules/collaborative-editor/use-collaborative-editor";

const applyLocalEditToReplicaPair = (
  localReplica: EgWalkerReplica,
  remoteReplica: EgWalkerReplica,
  newText: string,
): void => {
  const edit = computeLocalEdit(localReplica.getText(), newText);

  if (!edit) {
    return;
  }

  edit.apply(localReplica);
  const events = localReplica.exportEventGraph();
  const newEvents = events.slice(-edit.mappingOperations.length);
  for (const event of newEvents) {
    remoteReplica.applyRemoteEvent(event);
  }
};

describe("collaborative editor utilities", () => {
  it("syncs pure insertions between actual replicas", () => {
    const localReplica = new EgWalkerReplica("local");
    const remoteReplica = new EgWalkerReplica("remote");

    applyLocalEditToReplicaPair(localReplica, remoteReplica, "Hello");

    expect(localReplica.getText()).toBe("Hello");
    expect(remoteReplica.getText()).toBe("Hello");
  });

  it("syncs replacements with net length changes between actual replicas", () => {
    const localReplica = new EgWalkerReplica("local");
    const remoteReplica = new EgWalkerReplica("remote");

    applyLocalEditToReplicaPair(localReplica, remoteReplica, "abcXYZdef");
    applyLocalEditToReplicaPair(localReplica, remoteReplica, "abc12345def");

    expect(localReplica.getText()).toBe("abc12345def");
    expect(remoteReplica.getText()).toBe("abc12345def");
  });

  it("remaps remote selection only through successfully applied operations", async () => {
    const localReplica = new EgWalkerReplica("local");
    const remoteReplica = new EgWalkerReplica("remote");
    applyLocalEditToReplicaPair(localReplica, remoteReplica, "abcXYZdef");

    const localSync = createTextareaSelectionSync(null);
    const remoteSync = createTextareaSelectionSync({
      selectionStart: 8,
      selectionEnd: 8,
      selectionDirection: "none",
    });
    const setLocalText: Dispatch<SetStateAction<string>> = vi.fn();
    const setRemoteText: Dispatch<SetStateAction<string>> = vi.fn();
    const applyRemoteEvent = remoteReplica.applyRemoteEvent.bind(remoteReplica);
    let applyCount = 0;
    vi.spyOn(remoteReplica, "applyRemoteEvent").mockImplementation((event) => {
      applyCount++;
      if (applyCount === 2) {
        throw new Error("sync failed");
      }
      applyRemoteEvent(event);
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await runReplicaChange(
        {
          target: { value: "abc12345def" },
        } as ChangeEvent<HTMLTextAreaElement>,
        {
          localReplica,
          remoteReplica,
          localSync,
          remoteSync,
          setLocalText,
          setRemoteText,
          remoteLabel: "remote",
        },
      );
    } finally {
      consoleError.mockRestore();
    }

    expect(remoteReplica.getText()).toBe("abcdef");
    expect(remoteSync.restoreSelection).toHaveBeenCalledWith({
      selectionStart: 5,
      selectionEnd: 5,
      selectionDirection: "none",
    });
  });

  it("does not remap remote selection for buffered remote events", async () => {
    const localReplica = new EgWalkerReplica("local");
    const remoteReplica = new EgWalkerReplica("remote");
    const initialEdit = computeLocalEdit("", "abcXYZdef");
    initialEdit?.apply(localReplica);

    const localSync = createTextareaSelectionSync(null);
    const remoteSync = createTextareaSelectionSync({
      selectionStart: 0,
      selectionEnd: 0,
      selectionDirection: "none",
    });

    await runReplicaChange(
      {
        target: { value: "abc12345def" },
      } as ChangeEvent<HTMLTextAreaElement>,
      {
        localReplica,
        remoteReplica,
        localSync,
        remoteSync,
        setLocalText: vi.fn(),
        setRemoteText: vi.fn(),
        remoteLabel: "remote",
      },
    );

    expect(remoteReplica.getText()).toBe("");
    expect(remoteReplica.getPendingRemoteCount()).toBeGreaterThan(0);
    expect(remoteSync.restoreSelection).not.toHaveBeenCalled();
  });
});

const createTextareaSelectionSync = (
  selection: TextareaSelection | null,
): UseTextareaSelectionSyncResult => ({
  captureSelection: vi.fn(() => selection),
  restoreSelection: vi.fn((nextSelection = selection) => nextSelection),
  mapAndRestoreSelection: vi.fn(() => selection),
});
