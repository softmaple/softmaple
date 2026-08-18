import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COLLAB_RUNTIME,
  decideCollabRuntime,
  readCloudflareCollabBaseUrl,
  readCollabRuntimeRoutingConfig,
  resolveCollabRuntime,
  type CollabRuntimeRoutingConfig,
} from "@/modules/docs/collab-runtime-routing";

const baseConfig: CollabRuntimeRoutingConfig = {
  allowlist: new Set(),
  cloudflareConfigured: true,
  denylist: new Set(),
  override: null,
  rolloutPercent: 0,
};

describe("decideCollabRuntime", () => {
  it("always returns nitro when cloudflare is not configured", () => {
    expect(
      decideCollabRuntime("doc-1", {
        ...baseConfig,
        cloudflareConfigured: false,
        override: COLLAB_RUNTIME.Cloudflare,
        rolloutPercent: 100,
        allowlist: new Set(["doc-1"]),
      }),
    ).toBe(COLLAB_RUNTIME.Nitro);
  });

  it("denylist wins over allowlist for the same document", () => {
    expect(
      decideCollabRuntime("doc-1", {
        ...baseConfig,
        allowlist: new Set(["doc-1"]),
        denylist: new Set(["doc-1"]),
      }),
    ).toBe(COLLAB_RUNTIME.Nitro);
  });

  it("allowlist forces cloudflare regardless of percent/override", () => {
    expect(
      decideCollabRuntime("doc-1", {
        ...baseConfig,
        allowlist: new Set(["doc-1"]),
        override: COLLAB_RUNTIME.Nitro,
        rolloutPercent: 0,
      }),
    ).toBe(COLLAB_RUNTIME.Cloudflare);
  });

  it("override forces the runtime globally for documents on neither list", () => {
    expect(
      decideCollabRuntime("doc-1", {
        ...baseConfig,
        override: COLLAB_RUNTIME.Cloudflare,
        rolloutPercent: 0,
      }),
    ).toBe(COLLAB_RUNTIME.Cloudflare);
    expect(
      decideCollabRuntime("doc-2", {
        ...baseConfig,
        override: COLLAB_RUNTIME.Nitro,
        rolloutPercent: 100,
      }),
    ).toBe(COLLAB_RUNTIME.Nitro);
  });

  it("rolloutPercent 0 always resolves to nitro", () => {
    for (const documentId of ["a", "b", "c", "doc-123", "00000000-0000"]) {
      expect(
        decideCollabRuntime(documentId, { ...baseConfig, rolloutPercent: 0 }),
      ).toBe(COLLAB_RUNTIME.Nitro);
    }
  });

  it("rolloutPercent 100 always resolves to cloudflare", () => {
    for (const documentId of ["a", "b", "c", "doc-123", "00000000-0000"]) {
      expect(
        decideCollabRuntime(documentId, {
          ...baseConfig,
          rolloutPercent: 100,
        }),
      ).toBe(COLLAB_RUNTIME.Cloudflare);
    }
  });

  it("is deterministic for a given documentId and config", () => {
    const config: CollabRuntimeRoutingConfig = {
      ...baseConfig,
      rolloutPercent: 50,
    };
    const first = decideCollabRuntime("stable-doc-id", config);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(decideCollabRuntime("stable-doc-id", config)).toBe(first);
    }
  });

  it("distributes ids roughly across the configured percentage", () => {
    const config: CollabRuntimeRoutingConfig = {
      ...baseConfig,
      rolloutPercent: 50,
    };
    let cloudflareCount = 0;
    const sampleSize = 2000;
    for (let index = 0; index < sampleSize; index += 1) {
      if (
        decideCollabRuntime(`document-${index}`, config) ===
        COLLAB_RUNTIME.Cloudflare
      ) {
        cloudflareCount += 1;
      }
    }
    const ratio = cloudflareCount / sampleSize;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });
});

describe("readCollabRuntimeRoutingConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
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

  it("defaults to a fully-safe nitro-only config when unset", () => {
    const config = readCollabRuntimeRoutingConfig();
    expect(config.cloudflareConfigured).toBe(false);
    expect(config.override).toBeNull();
    expect(config.rolloutPercent).toBe(0);
    expect(config.allowlist.size).toBe(0);
    expect(config.denylist.size).toBe(0);
  });

  it("clamps out-of-range and non-numeric rollout percent", () => {
    process.env.COLLAB_CLOUDFLARE_ROLLOUT_PERCENT = "150";
    expect(readCollabRuntimeRoutingConfig().rolloutPercent).toBe(100);

    process.env.COLLAB_CLOUDFLARE_ROLLOUT_PERCENT = "-10";
    expect(readCollabRuntimeRoutingConfig().rolloutPercent).toBe(0);

    process.env.COLLAB_CLOUDFLARE_ROLLOUT_PERCENT = "not-a-number";
    expect(readCollabRuntimeRoutingConfig().rolloutPercent).toBe(0);
  });

  it("ignores an invalid COLLAB_RUNTIME_OVERRIDE value", () => {
    process.env.COLLAB_RUNTIME_OVERRIDE = "bogus";
    expect(readCollabRuntimeRoutingConfig().override).toBeNull();

    process.env.COLLAB_RUNTIME_OVERRIDE = "cloudflare";
    expect(readCollabRuntimeRoutingConfig().override).toBe(
      COLLAB_RUNTIME.Cloudflare,
    );
  });

  it("parses allow/deny lists, trimming and dropping empties", () => {
    process.env.COLLAB_CLOUDFLARE_DOCUMENT_ALLOWLIST = " doc-1, doc-2,,doc-3 ";
    const config = readCollabRuntimeRoutingConfig();
    expect([...config.allowlist].sort()).toEqual(["doc-1", "doc-2", "doc-3"]);
  });

  it("treats cloudflareConfigured as true only when an endpoint is set", () => {
    expect(readCollabRuntimeRoutingConfig().cloudflareConfigured).toBe(false);

    process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL =
      "wss://example.workers.dev";
    expect(readCollabRuntimeRoutingConfig().cloudflareConfigured).toBe(true);

    delete process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL;
    process.env.COLLAB_CLOUDFLARE_WS_URL = "wss://example.workers.dev";
    expect(readCollabRuntimeRoutingConfig().cloudflareConfigured).toBe(true);
  });
});

describe("readCloudflareCollabBaseUrl", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.COLLAB_CLOUDFLARE_WS_URL;
    delete process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is undefined when neither variable is set", () => {
    expect(readCloudflareCollabBaseUrl()).toBeUndefined();
  });

  it("treats an empty or blank value as unset", () => {
    process.env.COLLAB_CLOUDFLARE_WS_URL = "";
    expect(readCloudflareCollabBaseUrl()).toBeUndefined();

    process.env.COLLAB_CLOUDFLARE_WS_URL = "   ";
    expect(readCloudflareCollabBaseUrl()).toBeUndefined();
  });

  it("prefers the server-only variable over the legacy public one", () => {
    process.env.COLLAB_CLOUDFLARE_WS_URL = " wss://server-only.workers.dev ";
    process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL =
      "wss://legacy.workers.dev";
    expect(readCloudflareCollabBaseUrl()).toBe("wss://server-only.workers.dev");
  });

  it("falls back to the legacy public variable", () => {
    process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL =
      "wss://legacy.workers.dev";
    expect(readCloudflareCollabBaseUrl()).toBe("wss://legacy.workers.dev");
  });
});

describe("resolveCollabRuntime", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves to nitro by default with no configuration", () => {
    delete process.env.COLLAB_CLOUDFLARE_WS_URL;
    delete process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL;
    expect(resolveCollabRuntime("any-doc-id")).toBe(COLLAB_RUNTIME.Nitro);
  });
});
