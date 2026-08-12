import { afterEach, describe, expect, it } from "vitest";
import { COLLAB_RUNTIME } from "@/modules/docs/collab-runtime-routing";
import { buildCollabWebSocketUrl } from "@/modules/docs/collab-runtime-url";

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

  it("strips a trailing slash from the configured base url", () => {
    process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL =
      "wss://example.workers.dev/";
    expect(
      buildCollabWebSocketUrl(COLLAB_RUNTIME.Cloudflare, "/collab/presence"),
    ).toBe("wss://example.workers.dev/collab/presence");
  });

  it("falls back to same-origin nitro when cloudflare is requested but unconfigured", () => {
    delete process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL;
    expect(
      buildCollabWebSocketUrl(COLLAB_RUNTIME.Cloudflare, "/collab/document"),
    ).toBe(`ws://${window.location.host}/collab/document`);
  });
});
