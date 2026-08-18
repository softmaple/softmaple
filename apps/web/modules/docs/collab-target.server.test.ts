import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLLAB_RUNTIME } from "@/modules/docs/collab-runtime-routing";
import { resolveDocumentCollabTarget } from "@/modules/docs/collab-target.server";

const { requestHeaders } = vi.hoisted(() => ({
  requestHeaders: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => requestHeaders.get(name.toLowerCase()) ?? null,
  }),
}));

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000021";

describe("resolveDocumentCollabTarget", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    requestHeaders.clear();
    requestHeaders.set("host", "app.softmaple.ink");
    requestHeaders.set("x-forwarded-proto", "https");
    delete process.env.COLLAB_CLOUDFLARE_WS_URL;
    delete process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL;
    delete process.env.COLLAB_RUNTIME_OVERRIDE;
    delete process.env.COLLAB_CLOUDFLARE_ROLLOUT_PERCENT;
    delete process.env.COLLAB_CLOUDFLARE_DOCUMENT_ALLOWLIST;
    delete process.env.COLLAB_CLOUDFLARE_DOCUMENT_DENYLIST;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves same-origin nitro endpoints from the request", async () => {
    await expect(resolveDocumentCollabTarget(DOCUMENT_ID)).resolves.toEqual({
      documentUrl: "wss://app.softmaple.ink/collab/document",
      presenceUrl: "wss://app.softmaple.ink/collab/presence",
      runtime: COLLAB_RUNTIME.Nitro,
    });
  });

  it("resolves cloudflare endpoints for a cloudflare-owned document", async () => {
    process.env.COLLAB_CLOUDFLARE_WS_URL = "wss://example.workers.dev";
    process.env.COLLAB_CLOUDFLARE_DOCUMENT_ALLOWLIST = DOCUMENT_ID;

    await expect(resolveDocumentCollabTarget(DOCUMENT_ID)).resolves.toEqual({
      documentUrl: `wss://example.workers.dev/collab/document?documentId=${DOCUMENT_ID}`,
      presenceUrl: "wss://example.workers.dev/collab/presence",
      runtime: COLLAB_RUNTIME.Cloudflare,
    });
  });

  it("still accepts the legacy public endpoint variable", async () => {
    process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL =
      "wss://legacy.workers.dev";
    process.env.COLLAB_RUNTIME_OVERRIDE = COLLAB_RUNTIME.Cloudflare;

    const target = await resolveDocumentCollabTarget(DOCUMENT_ID);
    expect(target.runtime).toBe(COLLAB_RUNTIME.Cloudflare);
    expect(new URL(target.documentUrl).origin).toBe("wss://legacy.workers.dev");
  });

  it("prefers the server-only endpoint variable over the legacy one", async () => {
    process.env.COLLAB_CLOUDFLARE_WS_URL = "wss://server-only.workers.dev";
    process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL =
      "wss://legacy.workers.dev";
    process.env.COLLAB_RUNTIME_OVERRIDE = COLLAB_RUNTIME.Cloudflare;

    const target = await resolveDocumentCollabTarget(DOCUMENT_ID);
    expect(new URL(target.presenceUrl).origin).toBe(
      "wss://server-only.workers.dev",
    );
  });

  it("fails the render when a cloudflare-owned document has a broken endpoint", async () => {
    process.env.COLLAB_CLOUDFLARE_WS_URL = "example.workers.dev";
    process.env.COLLAB_CLOUDFLARE_DOCUMENT_ALLOWLIST = DOCUMENT_ID;

    await expect(resolveDocumentCollabTarget(DOCUMENT_ID)).rejects.toThrow(
      /Cloudflare collaboration runtime/,
    );
  });

  it("keeps every document on nitro while cloudflare is undeployed", async () => {
    process.env.COLLAB_RUNTIME_OVERRIDE = COLLAB_RUNTIME.Cloudflare;
    process.env.COLLAB_CLOUDFLARE_ROLLOUT_PERCENT = "100";
    process.env.COLLAB_CLOUDFLARE_DOCUMENT_ALLOWLIST = DOCUMENT_ID;

    const target = await resolveDocumentCollabTarget(DOCUMENT_ID);
    expect(target.runtime).toBe(COLLAB_RUNTIME.Nitro);
  });

  it("hands document and presence to the same runtime origin", async () => {
    process.env.COLLAB_CLOUDFLARE_WS_URL = "wss://example.workers.dev";
    process.env.COLLAB_CLOUDFLARE_ROLLOUT_PERCENT = "100";

    const target = await resolveDocumentCollabTarget(DOCUMENT_ID);
    expect(new URL(target.presenceUrl).origin).toBe(
      new URL(target.documentUrl).origin,
    );
    expect(new URL(target.documentUrl).origin).not.toBe(
      "wss://app.softmaple.ink",
    );
  });
});
