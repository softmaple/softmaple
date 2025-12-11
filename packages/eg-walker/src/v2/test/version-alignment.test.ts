/**
 * Tests for Section 3.2 — Version Alignment
 * Verify version comparison and alignment logic
 */

import { describe, it, expect } from "vitest";
import {
  FrontierVersion,
  compareVersions,
  VersionAlignmentManager,
} from "../walker-core/version-alignment";

describe("Section 3.2: Version Alignment", () => {
  describe("FrontierVersion", () => {
    it("should add and remove events", () => {
      const v1 = new FrontierVersion();
      expect(v1.has("e1")).toBe(false);

      const v2 = v1.add("e1");
      expect(v2.has("e1")).toBe(true);
      expect(v1.has("e1")).toBe(false); // Original unchanged

      const v3 = v2.add("e2");
      expect(v3.has("e1")).toBe(true);
      expect(v3.has("e2")).toBe(true);

      const v4 = v3.remove("e1");
      expect(v4.has("e1")).toBe(false);
      expect(v4.has("e2")).toBe(true);
    });

    it("should check equality correctly", () => {
      const v1 = new FrontierVersion(["e1", "e2"]);
      const v2 = new FrontierVersion(["e2", "e1"]); // Different order
      const v3 = new FrontierVersion(["e1", "e3"]);

      expect(v1.equals(v2)).toBe(true);
      expect(v1.equals(v3)).toBe(false);
    });
  });

  describe("compareVersions", () => {
    it("should identify differences between versions", () => {
      const v1 = new FrontierVersion(["e1", "e2", "e3"]);
      const v2 = new FrontierVersion(["e2", "e3", "e4"]);

      const diff = compareVersions(v1, v2);

      expect(Array.from(diff.onlyInA).sort()).toEqual(["e1"]);
      expect(Array.from(diff.onlyInB).sort()).toEqual(["e4"]);
      expect(Array.from(diff.inBoth).sort()).toEqual(["e2", "e3"]);
    });

    it("should handle empty versions", () => {
      const v1 = new FrontierVersion();
      const v2 = new FrontierVersion(["e1"]);

      const diff = compareVersions(v1, v2);

      expect(diff.onlyInA.size).toBe(0);
      expect(Array.from(diff.onlyInB)).toEqual(["e1"]);
      expect(diff.inBoth.size).toBe(0);
    });

    it("should handle identical versions", () => {
      const v1 = new FrontierVersion(["e1", "e2"]);
      const v2 = new FrontierVersion(["e1", "e2"]);

      const diff = compareVersions(v1, v2);

      expect(diff.onlyInA.size).toBe(0);
      expect(diff.onlyInB.size).toBe(0);
      expect(diff.inBoth.size).toBe(2);
    });
  });

  describe("VersionAlignmentManager", () => {
    it("should track prepare and effect versions", () => {
      const manager = new VersionAlignmentManager();

      // Initially empty
      expect(manager.getPrepareVersion().getEvents()).toEqual([]);
      expect(manager.getEffectVersion().getEvents()).toEqual([]);

      // Set prepare version
      manager.setPrepareVersion(new FrontierVersion(["e1"]));
      expect(manager.getPrepareVersion().has("e1")).toBe(true);

      // Add to effect version
      manager.addToEffectVersion("e1");
      manager.addToEffectVersion("e2");
      expect(manager.getEffectVersion().has("e1")).toBe(true);
      expect(manager.getEffectVersion().has("e2")).toBe(true);
    });

    it("should determine when retreat is needed", () => {
      const manager = new VersionAlignmentManager();

      // Prepare has [e1, e2], target has [e1]
      manager.setPrepareVersion(new FrontierVersion(["e1", "e2"]));
      const target = new FrontierVersion(["e1"]);

      expect(manager.needsRetreat(target)).toBe(true);
      expect(manager.getEventsToRetreat(target)).toEqual(["e2"]);
    });

    it("should determine when advance is needed", () => {
      const manager = new VersionAlignmentManager();

      // Prepare has [e1], target has [e1, e2]
      manager.setPrepareVersion(new FrontierVersion(["e1"]));
      const target = new FrontierVersion(["e1", "e2"]);

      expect(manager.needsAdvance(target)).toBe(true);
      expect(manager.getEventsToAdvance(target)).toEqual(["e2"]);
    });

    it("should handle both retreat and advance needed", () => {
      const manager = new VersionAlignmentManager();

      // Prepare has [e1, e2], target has [e1, e3]
      manager.setPrepareVersion(new FrontierVersion(["e1", "e2"]));
      const target = new FrontierVersion(["e1", "e3"]);

      expect(manager.needsRetreat(target)).toBe(true);
      expect(manager.needsAdvance(target)).toBe(true);
      expect(manager.getEventsToRetreat(target)).toEqual(["e2"]);
      expect(manager.getEventsToAdvance(target)).toEqual(["e3"]);
    });
  });
});
