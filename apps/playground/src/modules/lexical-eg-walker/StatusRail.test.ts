import { describe, expect, it } from "vitest";
import {
  formatStorageSize,
  persistenceLabel,
  syncStatusView,
} from "./syncStatus";

describe("collaboration status labels", () => {
  it("reports bytes and kibibytes compactly", () => {
    expect(formatStorageSize(812)).toBe("812 B");
    expect(formatStorageSize(1_536)).toBe("1.5 KB");
  });

  it("never describes memory-only state as remotely synced", () => {
    expect(persistenceLabel("unsaved", 2)).toBe(
      "Changes are only stored in memory",
    );
    expect(
      syncStatusView({
        connectionState: "connected",
        persistenceState: "unsaved",
        pendingCount: 0,
      }).label,
    ).toBe("Changes are only stored in memory");
  });

  it("uses product sync copy for connected and offline paths", () => {
    expect(
      syncStatusView({
        connectionState: "connected",
        persistenceState: "saved",
        pendingCount: 0,
        transportMode: "websocket",
      }).label,
    ).toBe("Synced");

    expect(
      syncStatusView({
        connectionState: "connected",
        persistenceState: "pending",
        pendingCount: 2,
        transportMode: "websocket",
      }).label,
    ).toBe("Saving changes…");

    expect(
      syncStatusView({
        connectionState: "disconnected",
        persistenceState: "saved",
        pendingCount: 4,
        transportMode: "websocket",
      }).label,
    ).toBe("Offline · 4 changes waiting");

    expect(
      syncStatusView({
        connectionState: "disconnected",
        persistenceState: "saved",
        pendingCount: 0,
        transportMode: "websocket",
      }).label,
    ).toBe("Offline · changes saved locally");
  });
});
