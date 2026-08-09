import { describe, expect, it } from "vitest";
import {
  buildCollabGatewayCanonicalPayload,
  COLLAB_GATEWAY_AUTH_HEADERS,
  createCollabGatewayAuthHeaders,
  parseCollabGatewayKeyring,
  parseCollabGatewaySignerConfig,
  verifyCollabGatewayAuthRequest,
} from "../src/index";

const SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const KEY_ID = "2026-08";
const TIMESTAMP = 1_786_248_000;
const NONCE = Buffer.from([...Array(16).keys()]);
const WEB_SOCKET_KEY = "dGhlIHNhbXBsZSBub25jZQ==";
const EXPECTED_SIGNATURE = "a-KK7tsOtMbo_QtSIpZhKvGmiJnsXrcZXLoFKHwMM3U";

const signer = parseCollabGatewaySignerConfig(KEY_ID, SECRET);
const keyring = parseCollabGatewayKeyring(
  JSON.stringify({
    [KEY_ID]: SECRET,
    previous: "Hx4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQA",
  }),
);

const signedRequest = (
  overrides: {
    readonly headers?: Headers;
    readonly method?: string;
    readonly path?: string;
  } = {},
): Request => {
  const authHeaders =
    overrides.headers ??
    createCollabGatewayAuthHeaders({
      config: signer,
      webSocketKey: WEB_SOCKET_KEY,
      nowSeconds: TIMESTAMP,
      nonce: NONCE,
    });
  if (!authHeaders.has("sec-websocket-key")) {
    authHeaders.set("sec-websocket-key", WEB_SOCKET_KEY);
  }
  return new Request(
    `https://collab.internal${overrides.path ?? "/document"}`,
    {
      method: overrides.method ?? "GET",
      headers: authHeaders,
    },
  );
};

describe("collaboration gateway HMAC", () => {
  it("matches the fixed golden vector", () => {
    const canonical = buildCollabGatewayCanonicalPayload({
      keyId: KEY_ID,
      timestamp: String(TIMESTAMP),
      nonce: "AAECAwQFBgcICQoLDA0ODw",
      method: "GET",
      path: "/document",
      webSocketKey: WEB_SOCKET_KEY,
    });
    const headers = createCollabGatewayAuthHeaders({
      config: signer,
      webSocketKey: WEB_SOCKET_KEY,
      nowSeconds: TIMESTAMP,
      nonce: NONCE,
    });

    expect(Buffer.byteLength(canonical, "utf8")).toBe(108);
    expect(canonical.endsWith("\n")).toBe(false);
    expect(headers.get(COLLAB_GATEWAY_AUTH_HEADERS.signature)).toBe(
      EXPECTED_SIGNATURE,
    );
    expect(
      verifyCollabGatewayAuthRequest(
        signedRequest({ headers }),
        keyring,
        TIMESTAMP,
      ),
    ).toEqual({ ok: true, keyId: KEY_ID });
  });

  it.each([
    [TIMESTAMP - 30, true],
    [TIMESTAMP + 30, true],
    [TIMESTAMP - 31, false],
    [TIMESTAMP + 31, false],
  ])("applies the 30 second clock window at %i", (nowSeconds, accepted) => {
    expect(
      verifyCollabGatewayAuthRequest(signedRequest(), keyring, nowSeconds).ok,
    ).toBe(accepted);
  });

  it("accepts current and previous keys from the keyring", () => {
    const previousSigner = parseCollabGatewaySignerConfig(
      "previous",
      "Hx4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQA",
    );
    const headers = createCollabGatewayAuthHeaders({
      config: previousSigner,
      webSocketKey: WEB_SOCKET_KEY,
      nowSeconds: TIMESTAMP,
      nonce: NONCE,
    });

    expect(
      verifyCollabGatewayAuthRequest(
        signedRequest({ headers }),
        keyring,
        TIMESTAMP,
      ),
    ).toEqual({ ok: true, keyId: "previous" });
  });

  it.each([
    ["method", signedRequest({ method: "POST" })],
    ["path", signedRequest({ path: "/other" })],
    ["query", signedRequest({ path: "/document?debug=1" })],
  ])("rejects a tampered %s", (_field, request) => {
    expect(verifyCollabGatewayAuthRequest(request, keyring, TIMESTAMP).ok).toBe(
      false,
    );
  });

  it.each([
    [COLLAB_GATEWAY_AUTH_HEADERS.version, "2"],
    [COLLAB_GATEWAY_AUTH_HEADERS.keyId, "unknown"],
    [COLLAB_GATEWAY_AUTH_HEADERS.timestamp, `0${TIMESTAMP}`],
    [COLLAB_GATEWAY_AUTH_HEADERS.nonce, "not-base64url"],
    [COLLAB_GATEWAY_AUTH_HEADERS.signature, "short"],
    ["sec-websocket-key", "not-a-websocket-key"],
  ])("rejects a tampered %s header", (header, value) => {
    const headers = createCollabGatewayAuthHeaders({
      config: signer,
      webSocketKey: WEB_SOCKET_KEY,
      nowSeconds: TIMESTAMP,
      nonce: NONCE,
    });
    headers.set(header, value);

    expect(
      verifyCollabGatewayAuthRequest(
        signedRequest({ headers }),
        keyring,
        TIMESTAMP,
      ).ok,
    ).toBe(false);
  });

  it("rejects a signature produced by another secret", () => {
    const wrongSigner = parseCollabGatewaySignerConfig(
      KEY_ID,
      "Hx4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQA",
    );
    const headers = createCollabGatewayAuthHeaders({
      config: wrongSigner,
      webSocketKey: WEB_SOCKET_KEY,
      nowSeconds: TIMESTAMP,
      nonce: NONCE,
    });

    expect(
      verifyCollabGatewayAuthRequest(
        signedRequest({ headers }),
        keyring,
        TIMESTAMP,
      ),
    ).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it.each([
    ["padded secret", `${SECRET}=`],
    ["short secret", "AAECAw"],
    ["invalid key ID", "not a key"],
  ])("rejects invalid signer configuration: %s", (_case, value) => {
    expect(() =>
      value === "not a key"
        ? parseCollabGatewaySignerConfig(value, SECRET)
        : parseCollabGatewaySignerConfig(KEY_ID, value),
    ).toThrow();
  });

  it.each([
    [undefined],
    ["not-json"],
    ["[]"],
    ["{}"],
    [`{"${KEY_ID}":"short"}`],
  ])("rejects an invalid keyring: %s", (serialized) => {
    expect(() => parseCollabGatewayKeyring(serialized)).toThrow();
  });
});
