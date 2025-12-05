import { describe, expect, it } from "vitest";
import { sanitizeRedirectUrl } from "./sanitize-redirect";

describe("sanitizeRedirectUrl", () => {
  describe("valid URLs", () => {
    it("should allow relative paths starting with /", () => {
      expect(sanitizeRedirectUrl("/dashboard")).toBe("/dashboard");
      expect(sanitizeRedirectUrl("/workspace/123")).toBe("/workspace/123");
      expect(sanitizeRedirectUrl("/auth/login")).toBe("/auth/login");
      expect(sanitizeRedirectUrl("/")).toBe("/");
    });

    it("should trim whitespace from valid URLs", () => {
      expect(sanitizeRedirectUrl(" /dashboard ")).toBe("/dashboard");
      expect(sanitizeRedirectUrl("\t/workspace\n")).toBe("/workspace");
    });
  });

  describe("invalid URLs - should return /", () => {
    it("should reject null, undefined, and empty strings", () => {
      expect(sanitizeRedirectUrl(null)).toBe("/");
      expect(sanitizeRedirectUrl("")).toBe("/");
      expect(sanitizeRedirectUrl("   ")).toBe("/");
    });

    it("should reject protocol-relative URLs", () => {
      expect(sanitizeRedirectUrl("//evil.com")).toBe("/");
      expect(sanitizeRedirectUrl("//evil.com/path")).toBe("/");
      expect(sanitizeRedirectUrl("///evil.com")).toBe("/");
    });

    it("should reject absolute URLs with protocols", () => {
      expect(sanitizeRedirectUrl("http://evil.com")).toBe("/");
      expect(sanitizeRedirectUrl("https://evil.com")).toBe("/");
      expect(sanitizeRedirectUrl("ftp://evil.com")).toBe("/");
      expect(sanitizeRedirectUrl("javascript:alert(1)")).toBe("/");
      expect(sanitizeRedirectUrl("data:text/html,<script>alert(1)</script>")).toBe("/");
    });

    it("should reject URLs with @ character", () => {
      expect(sanitizeRedirectUrl("//user@evil.com")).toBe("/");
      expect(sanitizeRedirectUrl("/path@evil.com")).toBe("/");
      expect(sanitizeRedirectUrl("/@evil.com")).toBe("/");
    });

    it("should reject URLs with backslashes", () => {
      expect(sanitizeRedirectUrl("\\evil.com")).toBe("/");
      expect(sanitizeRedirectUrl("/\\evil.com")).toBe("/");
      expect(sanitizeRedirectUrl("/path\\..\\etc")).toBe("/");
    });

    it("should reject URLs that don't start with /", () => {
      expect(sanitizeRedirectUrl("evil.com")).toBe("/");
      expect(sanitizeRedirectUrl("path/to/page")).toBe("/");
      expect(sanitizeRedirectUrl("../../../etc/passwd")).toBe("/");
    });

    it("should reject URL-encoded malicious patterns", () => {
      expect(sanitizeRedirectUrl("%2F%2Fevil.com")).toBe("/");
      expect(sanitizeRedirectUrl("/path%3A%2F%2Fevil.com")).toBe("/");
      expect(sanitizeRedirectUrl("/path%40evil.com")).toBe("/");
      expect(sanitizeRedirectUrl("/%5Cevil.com")).toBe("/");
    });

    it("should handle invalid URL encoding gracefully", () => {
      expect(sanitizeRedirectUrl("/path%G%invalid")).toBe("/path%G%invalid");
      expect(sanitizeRedirectUrl("/%E0%A4%A")).toBe("/");
    });
  });
});
