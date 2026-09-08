import { describe, expect, it } from "vitest";
import { STATUS_LEVEL } from "@/components/shell/status-indicator";
import {
  describeCollaborationStatus,
  describeSaveStatus,
  summariseDocumentStatus,
} from "@/modules/docs/document-status";
import type {
  CollaborationStatus,
  SaveStatus,
} from "@/modules/docs/document-save-coordinator";

const SAVE_STATUSES: ReadonlyArray<SaveStatus> = [
  "idle",
  "saving",
  "saved",
  "error",
];
const COLLABORATION_STATUSES: ReadonlyArray<CollaborationStatus> = [
  "disabled",
  "connecting",
  "connected",
  "reconnecting",
  "offline",
  "error",
];

describe("document status descriptors", () => {
  it("describes every save and collaboration status", () => {
    for (const status of SAVE_STATUSES) {
      expect(describeSaveStatus(status).label.length).toBeGreaterThan(0);
      expect(describeSaveStatus(status).detail.length).toBeGreaterThan(0);
    }
    for (const status of COLLABORATION_STATUSES) {
      expect(describeCollaborationStatus(status).label.length).toBeGreaterThan(
        0,
      );
    }
  });

  it("never lets a connectivity problem claim the work is unsaved", () => {
    for (const status of COLLABORATION_STATUSES) {
      expect(describeCollaborationStatus(status).name).toBe(
        "Live collaboration",
      );
      expect(describeCollaborationStatus(status).detail).not.toMatch(
        /\bunsaved\b/i,
      );
    }
  });

  it("keeps offline reassuring about durability", () => {
    for (const status of ["reconnecting", "offline"] as const) {
      expect(describeCollaborationStatus(status).detail).toMatch(
        /keep writing/i,
      );
    }
  });

  it("treats a failed save as critical and actionable", () => {
    const failed = describeSaveStatus("error");
    expect(failed.level).toBe(STATUS_LEVEL.Critical);
    expect(failed.actionable).toBe(true);
  });

  it("reports both facts in a spoken summary, durability first", () => {
    const summary = summariseDocumentStatus({
      collaborationStatus: "offline",
      saveStatus: "saved",
    });
    expect(summary.indexOf("saved")).toBeLessThan(summary.indexOf("Offline"));
  });

  it("does not report a private document as a connection problem", () => {
    const disabled = describeCollaborationStatus("disabled");
    expect(disabled.level).toBe(STATUS_LEVEL.Settled);
    expect(disabled.actionable).toBe(false);
  });
});
