// @vitest-environment node

import {
  COLLAB_GATEWAY_AUTH_HEADER_NAMES,
  parseCollabGatewayKeyring,
  verifyCollabGatewayAuthRequest,
} from "@softmaple/collab-gateway-auth";
import { getRewrittenUrl, isRewrite } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateSession: vi.fn(() => new Response("session")),
}));

vi.mock("@/utils/supabase/middleware", () => ({
  updateSession: mocks.updateSession,
}));

import { proxy } from "./proxy";

const SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const KEY_ID = "2026-08";
const WEB_SOCKET_KEY = "dGhlIHNhbXBsZSBub25jZQ==";

const configureGateway = (): void => {
  vi.stubEnv("COLLAB_BACKEND_ORIGIN", "http://localhost:3002");
  vi.stubEnv("COLLAB_GATEWAY_HMAC_KEY_ID", KEY_ID);
  vi.stubEnv("COLLAB_GATEWAY_HMAC_SECRET", SECRET);
};

const upgradeRequest = (
  origin: string | null,
  path = "/collab/document",
  extraHeaders: Readonly<Record<string, string>> = {},
  requestOrigin = origin !== null && origin !== "null"
    ? origin
    : "https://example.com",
): NextRequest => {
  const headers = new Headers({
    connection: "keep-alive, Upgrade",
    "sec-websocket-key": WEB_SOCKET_KEY,
    "sec-websocket-version": "13",
    upgrade: "websocket",
    ...extraHeaders,
  });
  if (origin !== null) headers.set("origin", origin);
  return new NextRequest(`${requestOrigin}${path}`, {
    method: "GET",
    headers,
  });
};

const overriddenRequestHeaders = (response: Response): Headers => {
  const names =
    response.headers.get("x-middleware-override-headers")?.split(",") ?? [];
  const entries: [string, string][] = names.map((name) => [
    name,
    response.headers.get(`x-middleware-request-${name}`) ?? "",
  ]);
  return new Headers(entries);
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("collaboration WebSocket gateway", () => {
  it.each([
    "https://softmaple.ink",
    "https://feature-123.vercel.app",
    "https://docs.example.org",
    "http://localhost:3000",
  ])("rewrites a same-origin upgrade from %s", async (origin) => {
    configureGateway();

    const response = await proxy(upgradeRequest(origin));

    expect(isRewrite(response)).toBe(true);
    expect(getRewrittenUrl(response)).toBe("http://localhost:3002/document");
    expect(mocks.updateSession).not.toHaveBeenCalled();
    const forwarded = overriddenRequestHeaders(response);
    const verificationRequest = new Request("http://localhost:3002/document", {
      method: "GET",
      headers: forwarded,
    });
    expect(
      verifyCollabGatewayAuthRequest(
        verificationRequest,
        parseCollabGatewayKeyring(JSON.stringify({ [KEY_ID]: SECRET })),
      ),
    ).toEqual({ ok: true, keyId: KEY_ID });
  });

  it.each([
    ["cross-origin", "https://evil.example", 403],
    ["missing Origin", null, 403],
    ["null Origin", "null", 403],
  ])("rejects a %s upgrade", async (_case, origin, status) => {
    configureGateway();
    const request = upgradeRequest(
      origin,
      "/collab/document",
      {},
      "https://softmaple.ink",
    );

    expect((await proxy(request)).status).toBe(status);
  });

  it.each([
    ["query", upgradeRequest("https://example.com", "/collab/document?x=1")],
    [
      "non-upgrade",
      new NextRequest("https://example.com/collab/document", {
        headers: { origin: "https://example.com" },
      }),
    ],
  ])("rejects a %s request", async (_case, request) => {
    configureGateway();
    expect((await proxy(request)).status).toBe(400);
  });

  it("overwrites forged auth headers and strips ambient credentials", async () => {
    configureGateway();
    const forgedHeaders = Object.fromEntries(
      COLLAB_GATEWAY_AUTH_HEADER_NAMES.map((header) => [header, "forged"]),
    );
    const response = await proxy(
      upgradeRequest("https://example.com", "/collab/document", {
        ...forgedHeaders,
        authorization: "Bearer browser-token",
        cookie: "session=browser-cookie",
        "proxy-authorization": "Basic proxy-token",
      }),
    );
    const forwarded = overriddenRequestHeaders(response);

    for (const header of COLLAB_GATEWAY_AUTH_HEADER_NAMES) {
      expect(forwarded.get(header)).not.toBe("forged");
      expect(response.headers.has(header)).toBe(false);
    }
    expect(forwarded.has("authorization")).toBe(false);
    expect(forwarded.has("cookie")).toBe(false);
    expect(forwarded.has("proxy-authorization")).toBe(false);
    expect(forwarded.get("upgrade")).toBe("websocket");
    expect(forwarded.get("sec-websocket-key")).toBe(WEB_SOCKET_KEY);
  });

  it("fails closed when gateway configuration is missing", async () => {
    vi.stubEnv("COLLAB_BACKEND_ORIGIN", undefined);
    vi.stubEnv("COLLAB_GATEWAY_HMAC_KEY_ID", undefined);
    vi.stubEnv("COLLAB_GATEWAY_HMAC_SECRET", undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await proxy(upgradeRequest("https://example.com"))).status).toBe(
      503,
    );
  });

  it("preserves Supabase session handling for other paths", async () => {
    const request = new NextRequest("https://example.com/dashboard");
    const response = await proxy(request);

    expect(await response.text()).toBe("session");
    expect(mocks.updateSession).toHaveBeenCalledWith(request);
  });
});
