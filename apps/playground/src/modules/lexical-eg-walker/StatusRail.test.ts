import { describe, expect, it } from "vitest";
import { formatStorageSize, persistenceLabel } from "./StatusRail";

describe("collaboration status labels", () => {
  it("reports bytes and kibibytes compactly", () => {
    expect(formatStorageSize(812)).toBe("812 B");
    expect(formatStorageSize(1_536)).toBe("1.5 KB");
  });

  it("never describes memory-only state as saved", () => {
    expect(persistenceLabel("unsaved", 2)).toBe("Unsaved · memory only");
    expect(persistenceLabel("pending", 2)).toBe("2 changes pending");
  });
});
