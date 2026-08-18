import { afterEach, describe, expect, it } from "vitest";
import { COLLAB_RUNTIME } from "@/modules/docs/collab-runtime-routing";
import { buildCollabWebSocketUrl } from "@/modules/docs/collab-runtime-url";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000021";

describe("buildCollabWebSocketUrl", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("builds a same-origin ws url for nitro, matching prior hardcoded behavior", () => {
    expect(
      buildCollabWebSocketUrl(COLLAB_RUNTIME.Nitro, "/collab/document"),
    ).toBe(`ws://${window.location.host}/collab/document`);
    expect(
      buildCollabWebSocketUrl(COLLAB_RUNTIME.Nitro, "/collab/presence"),
    ).toBe(`ws://${window.location.host}/collab/presence`);
  });

  it("uses the configured cloudflare base url when set", () => {
    process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL =
      "wss://example.workers.dev";
    expect(
      buildCollabWebSocketUrl(COLLAB_RUNTIME.Cloudflare, "/collab/document"),
    ).toBe("wss://example.workers.dev/collab/document");
  });

  it("routes cloudflare document sockets with the document id", () => {
    process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL =
      "wss://example.workers.dev";
    expect(
      buildCollabWebSocketUrl(COLLAB_RUNTIME.Cloudflare, "/collab/document", {
        documentId: DOCUMENT_ID,
      }),
    ).toBe(
      `wss://example.workers.dev/collab/document?documentId=${DOCUMENT_ID}`,
    );
  });

  it("encodes routing parameters instead of concatenating them", () => {
    process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL =
      "wss://example.workers.dev";
    expect(
      buildCollabWebSocketUrl(COLLAB_RUNTIME.Cloudflare, "/collab/document", {
        documentId: "not a/document id",
      }),
    ).toBe(
      "wss://example.workers.dev/collab/document?documentId=not+a%2Fdocument+id",
    );
  });

  it("strips a trailing slash from the configured base url", () => {
    process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL =
      "wss://example.workers.dev/";
    expect(
      buildCollabWebSocketUrl(COLLAB_RUNTIME.Cloudflare, "/collab/presence"),
    ).toBe("wss://example.workers.dev/collab/presence");
    expect(
      buildCollabWebSocketUrl(COLLAB_RUNTIME.Cloudflare, "/collab/document", {
        documentId: DOCUMENT_ID,
      }),
    ).toBe(
      `wss://example.workers.dev/collab/document?documentId=${DOCUMENT_ID}`,
    );
  });

  it("falls back to same-origin nitro when cloudflare is requested but unconfigured", () => {
    delete process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL;
    expect(
      buildCollabWebSocketUrl(COLLAB_RUNTIME.Cloudflare, "/collab/document"),
    ).toBe(`ws://${window.location.host}/collab/document`);
  });

  it("keeps the nitro url query-free: only cloudflare routes on the url", () => {
    delete process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL;
    expect(
      buildCollabWebSocketUrl(COLLAB_RUNTIME.Cloudflare, "/collab/document", {
        documentId: DOCUMENT_ID,
      }),
    ).toBe(`ws://${window.location.host}/collab/document`);
    expect(
      buildCollabWebSocketUrl(COLLAB_RUNTIME.Nitro, "/collab/document", {
        documentId: DOCUMENT_ID,
      }),
    ).toBe(`ws://${window.location.host}/collab/document`);
  });
});
