import { describe, expect, it } from "vitest";
import { COLLAB_RUNTIME } from "@/modules/docs/collab-runtime-routing";
import {
  resolveCollabTarget,
  sameOriginCollabBaseUrl,
  type CollabTarget,
} from "@/modules/docs/collab-target";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000021";
const SAME_ORIGIN = "wss://app.softmaple.ink";
const CLOUDFLARE = "wss://example.workers.dev";

const nitroTarget = (
  overrides: { readonly sameOriginBaseUrl?: string } = {},
): CollabTarget =>
  resolveCollabTarget({
    cloudflareBaseUrl: undefined,
    documentId: DOCUMENT_ID,
    runtime: COLLAB_RUNTIME.Nitro,
    sameOriginBaseUrl: overrides.sameOriginBaseUrl ?? SAME_ORIGIN,
  });

const cloudflareTarget = (
  cloudflareBaseUrl: string | undefined,
): CollabTarget =>
  resolveCollabTarget({
    cloudflareBaseUrl,
    documentId: DOCUMENT_ID,
    runtime: COLLAB_RUNTIME.Cloudflare,
    sameOriginBaseUrl: SAME_ORIGIN,
  });

describe("resolveCollabTarget: nitro", () => {
  it("puts document and presence on the same-origin nitro endpoint", () => {
    expect(nitroTarget()).toEqual({
      documentUrl: `${SAME_ORIGIN}/collab/document`,
      presenceUrl: `${SAME_ORIGIN}/collab/presence`,
      runtime: COLLAB_RUNTIME.Nitro,
    });
  });

  it("keeps nitro urls query-free: only cloudflare routes on the url", () => {
    const target = nitroTarget();
    expect(new URL(target.documentUrl).search).toBe("");
    expect(new URL(target.presenceUrl).search).toBe("");
  });

  it("ignores a configured cloudflare endpoint entirely", () => {
    const target = resolveCollabTarget({
      cloudflareBaseUrl: CLOUDFLARE,
      documentId: DOCUMENT_ID,
      runtime: COLLAB_RUNTIME.Nitro,
      sameOriginBaseUrl: SAME_ORIGIN,
    });
    expect(target).toEqual(nitroTarget());
  });

  it("normalizes an http(s) same-origin base to ws(s)", () => {
    expect(nitroTarget({ sameOriginBaseUrl: "http://127.0.0.1:3000" })).toEqual(
      {
        documentUrl: "ws://127.0.0.1:3000/collab/document",
        presenceUrl: "ws://127.0.0.1:3000/collab/presence",
        runtime: COLLAB_RUNTIME.Nitro,
      },
    );
  });
});

describe("resolveCollabTarget: cloudflare", () => {
  it("puts document and presence on the configured worker endpoint", () => {
    expect(cloudflareTarget(CLOUDFLARE)).toEqual({
      documentUrl: `${CLOUDFLARE}/collab/document?documentId=${DOCUMENT_ID}`,
      presenceUrl: `${CLOUDFLARE}/collab/presence`,
      runtime: COLLAB_RUNTIME.Cloudflare,
    });
  });

  it("encodes the routing parameter instead of concatenating it", () => {
    const target = resolveCollabTarget({
      cloudflareBaseUrl: CLOUDFLARE,
      documentId: "not a/document id",
      runtime: COLLAB_RUNTIME.Cloudflare,
      sameOriginBaseUrl: SAME_ORIGIN,
    });
    expect(target.documentUrl).toBe(
      `${CLOUDFLARE}/collab/document?documentId=not+a%2Fdocument+id`,
    );
  });

  it("strips trailing slashes and keeps a configured base path", () => {
    expect(cloudflareTarget(`${CLOUDFLARE}/`).presenceUrl).toBe(
      `${CLOUDFLARE}/collab/presence`,
    );
    expect(cloudflareTarget(`${CLOUDFLARE}/edge/`).documentUrl).toBe(
      `${CLOUDFLARE}/edge/collab/document?documentId=${DOCUMENT_ID}`,
    );
  });

  it("normalizes an https base to wss", () => {
    expect(cloudflareTarget("https://example.workers.dev").presenceUrl).toBe(
      `${CLOUDFLARE}/collab/presence`,
    );
  });

  it("leaves the presence base query-free for the awareness roomId", () => {
    expect(new URL(cloudflareTarget(CLOUDFLARE).presenceUrl).search).toBe("");
  });
});

describe("resolveCollabTarget: cloudflare misconfiguration", () => {
  const unusable: ReadonlyArray<readonly [string, string | undefined]> = [
    ["unset", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["not a url", "example.workers.dev"],
    ["a non-socket scheme", "ftp://example.workers.dev"],
    ["a query string", "wss://example.workers.dev?token=secret"],
    ["a fragment", "wss://example.workers.dev#room"],
  ];

  it.each(unusable)("throws when the endpoint is %s", (_label, base) => {
    expect(() => cloudflareTarget(base)).toThrow(
      /Cloudflare collaboration runtime|not a valid URL|must use|must not carry/,
    );
  });

  it("never answers with a target of another runtime", () => {
    for (const [label, base] of unusable) {
      let outcome: CollabTarget | Error;
      try {
        outcome = cloudflareTarget(base);
      } catch (error) {
        outcome = error as Error;
      }
      expect(outcome, `cloudflare endpoint ${label}`).toBeInstanceOf(Error);
    }
  });

  it("names the missing configuration when the endpoint is unset", () => {
    expect(() => cloudflareTarget(undefined)).toThrow(
      /Cloudflare collaboration runtime was selected but its endpoint is not configured/,
    );
  });
});

describe("collab target runtime consistency", () => {
  const targets: ReadonlyArray<CollabTarget> = [
    nitroTarget(),
    cloudflareTarget(CLOUDFLARE),
  ];

  it("keeps document and presence on one runtime's origin", () => {
    for (const target of targets) {
      expect(new URL(target.presenceUrl).origin).toBe(
        new URL(target.documentUrl).origin,
      );
    }
  });

  it("resolves each runtime to its own backend, never the other", () => {
    const nitro = nitroTarget();
    const cloudflare = cloudflareTarget(CLOUDFLARE);
    expect(new URL(nitro.documentUrl).origin).toBe(SAME_ORIGIN);
    expect(new URL(cloudflare.documentUrl).origin).toBe(CLOUDFLARE);
    expect(new URL(cloudflare.presenceUrl).origin).toBe(CLOUDFLARE);
    expect(new URL(cloudflare.documentUrl).origin).not.toBe(
      new URL(nitro.documentUrl).origin,
    );
  });

  it("reports the runtime it actually resolved endpoints for", () => {
    expect(nitroTarget().runtime).toBe(COLLAB_RUNTIME.Nitro);
    expect(cloudflareTarget(CLOUDFLARE).runtime).toBe(
      COLLAB_RUNTIME.Cloudflare,
    );
  });
});

describe("sameOriginCollabBaseUrl", () => {
  it("prefers the forwarded host over the direct host header", () => {
    expect(
      sameOriginCollabBaseUrl({
        forwardedHost: "app.softmaple.ink",
        forwardedProto: "https",
        host: "internal.vercel.app",
      }),
    ).toBe("wss://app.softmaple.ink");
  });

  it("maps the forwarded protocol to ws/wss", () => {
    expect(
      sameOriginCollabBaseUrl({
        forwardedHost: null,
        forwardedProto: "http",
        host: "example.test",
      }),
    ).toBe("ws://example.test");
  });

  it("uses the first value of a comma-joined proxy header", () => {
    expect(
      sameOriginCollabBaseUrl({
        forwardedHost: "app.softmaple.ink, internal.vercel.app",
        forwardedProto: "https, http",
        host: null,
      }),
    ).toBe("wss://app.softmaple.ink");
  });

  it("assumes ws for loopback hosts without a proxy hint", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      expect(
        sameOriginCollabBaseUrl({
          forwardedHost: null,
          forwardedProto: null,
          host,
        }),
      ).toBe(`ws://${host}`);
    }
  });

  it("assumes wss for a public host without a proxy hint", () => {
    expect(
      sameOriginCollabBaseUrl({
        forwardedHost: null,
        forwardedProto: null,
        host: "app.softmaple.ink",
      }),
    ).toBe("wss://app.softmaple.ink");
  });

  it("throws when no host header identifies the request origin", () => {
    expect(() =>
      sameOriginCollabBaseUrl({
        forwardedHost: "  ",
        forwardedProto: "https",
        host: null,
      }),
    ).toThrow(/Could not resolve the request host/);
  });
});
