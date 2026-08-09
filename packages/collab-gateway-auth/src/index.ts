import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const AUTH_VERSION = "1";
const CANONICAL_PREFIX = "softmaple-collab-upgrade-v1";
const UPGRADE_METHOD = "GET";
const UPGRADE_PATH = "/document";
const MAX_CLOCK_SKEW_SECONDS = 30;
const KEY_BYTE_LENGTH = 32;
const NONCE_BYTE_LENGTH = 16;
const SIGNATURE_BYTE_LENGTH = 32;
const WEB_SOCKET_KEY_BYTE_LENGTH = 16;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const TIMESTAMP_PATTERN = /^(0|[1-9][0-9]{0,12})$/;
const UNPADDED_BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const STANDARD_BASE64_PATTERN = /^[A-Za-z0-9+/]{22}==$/;

export const COLLAB_GATEWAY_AUTH_HEADERS = Object.freeze({
  version: "x-softmaple-collab-auth-version",
  keyId: "x-softmaple-collab-key-id",
  timestamp: "x-softmaple-collab-timestamp",
  nonce: "x-softmaple-collab-nonce",
  signature: "x-softmaple-collab-signature",
});

export const COLLAB_GATEWAY_AUTH_HEADER_NAMES = Object.freeze(
  Object.values(COLLAB_GATEWAY_AUTH_HEADERS),
);

export interface CollabGatewaySignerConfig {
  readonly keyId: string;
  readonly secret: Uint8Array;
}

export type CollabGatewayKeyring = ReadonlyMap<string, Uint8Array>;

interface CanonicalPayloadInput {
  readonly keyId: string;
  readonly timestamp: string;
  readonly nonce: string;
  readonly method: string;
  readonly path: string;
  readonly webSocketKey: string;
}

interface CreateAuthHeadersInput {
  readonly config: CollabGatewaySignerConfig;
  readonly webSocketKey: string;
  readonly nowSeconds?: number;
  readonly nonce?: Uint8Array;
}

export type CollabGatewayVerificationFailureReason =
  | "expired"
  | "invalid-headers"
  | "invalid-request"
  | "invalid-signature"
  | "unknown-key";

export type CollabGatewayVerificationResult =
  | {
      readonly ok: true;
      readonly keyId: string;
    }
  | {
      readonly ok: false;
      readonly reason: CollabGatewayVerificationFailureReason;
    };

export class CollabGatewayAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollabGatewayAuthConfigurationError";
  }
}

const decodeUnpaddedBase64Url = (
  value: string,
  expectedByteLength: number,
): Uint8Array | null => {
  if (!UNPADDED_BASE64URL_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.byteLength !== expectedByteLength ||
    decoded.toString("base64url") !== value
  ) {
    return null;
  }
  return decoded;
};

const isValidWebSocketKey = (value: string): boolean => {
  if (!STANDARD_BASE64_PATTERN.test(value)) return false;
  const decoded = Buffer.from(value, "base64");
  return (
    decoded.byteLength === WEB_SOCKET_KEY_BYTE_LENGTH &&
    decoded.toString("base64") === value
  );
};

const parseTimestamp = (value: string): number | null => {
  if (!TIMESTAMP_PATTERN.test(value)) return null;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) ? timestamp : null;
};

const assertKeyId = (keyId: string): void => {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new CollabGatewayAuthConfigurationError(
      "The collaboration gateway key ID is invalid",
    );
  }
};

const parseSecret = (secret: string): Uint8Array => {
  const decoded = decodeUnpaddedBase64Url(secret, KEY_BYTE_LENGTH);
  if (decoded === null) {
    throw new CollabGatewayAuthConfigurationError(
      "The collaboration gateway secret must be 32-byte unpadded base64url",
    );
  }
  return decoded;
};

export const parseCollabGatewaySignerConfig = (
  keyId: string | undefined,
  secret: string | undefined,
): CollabGatewaySignerConfig => {
  if (keyId === undefined || secret === undefined) {
    throw new CollabGatewayAuthConfigurationError(
      "The collaboration gateway signer is not configured",
    );
  }
  assertKeyId(keyId);
  return Object.freeze({ keyId, secret: parseSecret(secret) });
};

export const parseCollabGatewayKeyring = (
  serializedKeyring: string | undefined,
): CollabGatewayKeyring => {
  if (serializedKeyring === undefined) {
    throw new CollabGatewayAuthConfigurationError(
      "The collaboration gateway keyring is not configured",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedKeyring);
  } catch {
    throw new CollabGatewayAuthConfigurationError(
      "The collaboration gateway keyring is not valid JSON",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CollabGatewayAuthConfigurationError(
      "The collaboration gateway keyring must be an object",
    );
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    throw new CollabGatewayAuthConfigurationError(
      "The collaboration gateway keyring must not be empty",
    );
  }

  const decodedEntries = entries.map(([keyId, secret]) => {
    assertKeyId(keyId);
    if (typeof secret !== "string") {
      throw new CollabGatewayAuthConfigurationError(
        "Every collaboration gateway key must be a string",
      );
    }
    return [keyId, parseSecret(secret)] as const;
  });
  return new Map(decodedEntries);
};

export const buildCollabGatewayCanonicalPayload = ({
  keyId,
  timestamp,
  nonce,
  method,
  path,
  webSocketKey,
}: CanonicalPayloadInput): string =>
  [CANONICAL_PREFIX, keyId, timestamp, nonce, method, path, webSocketKey].join(
    "\n",
  );

const createSignature = (
  secret: Uint8Array,
  canonicalPayload: string,
): string =>
  createHmac("sha256", secret)
    .update(canonicalPayload, "utf8")
    .digest("base64url");

export const createCollabGatewayAuthHeaders = ({
  config,
  webSocketKey,
  nowSeconds = Math.floor(Date.now() / 1000),
  nonce = randomBytes(NONCE_BYTE_LENGTH),
}: CreateAuthHeadersInput): Headers => {
  assertKeyId(config.keyId);
  if (config.secret.byteLength !== KEY_BYTE_LENGTH) {
    throw new CollabGatewayAuthConfigurationError(
      "The collaboration gateway signer secret has an invalid length",
    );
  }
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new CollabGatewayAuthConfigurationError(
      "The collaboration gateway timestamp is invalid",
    );
  }
  if (nonce.byteLength !== NONCE_BYTE_LENGTH) {
    throw new CollabGatewayAuthConfigurationError(
      "The collaboration gateway nonce must be 16 bytes",
    );
  }
  if (!isValidWebSocketKey(webSocketKey)) {
    throw new CollabGatewayAuthConfigurationError(
      "The WebSocket key is invalid",
    );
  }

  const timestamp = String(nowSeconds);
  const encodedNonce = Buffer.from(nonce).toString("base64url");
  const canonicalPayload = buildCollabGatewayCanonicalPayload({
    keyId: config.keyId,
    timestamp,
    nonce: encodedNonce,
    method: UPGRADE_METHOD,
    path: UPGRADE_PATH,
    webSocketKey,
  });
  const signature = createSignature(config.secret, canonicalPayload);

  return new Headers({
    [COLLAB_GATEWAY_AUTH_HEADERS.version]: AUTH_VERSION,
    [COLLAB_GATEWAY_AUTH_HEADERS.keyId]: config.keyId,
    [COLLAB_GATEWAY_AUTH_HEADERS.timestamp]: timestamp,
    [COLLAB_GATEWAY_AUTH_HEADERS.nonce]: encodedNonce,
    [COLLAB_GATEWAY_AUTH_HEADERS.signature]: signature,
  });
};

export const hasCollabGatewayAuthHeaders = (headers: Headers): boolean =>
  COLLAB_GATEWAY_AUTH_HEADER_NAMES.some((header) => headers.has(header));

const invalid = (
  reason: CollabGatewayVerificationFailureReason,
): CollabGatewayVerificationResult => ({ ok: false, reason });

export const verifyCollabGatewayAuthRequest = (
  request: Request,
  keyring: CollabGatewayKeyring,
  nowSeconds = Math.floor(Date.now() / 1000),
): CollabGatewayVerificationResult => {
  const url = new URL(request.url);
  if (
    request.method !== UPGRADE_METHOD ||
    url.pathname !== UPGRADE_PATH ||
    url.search !== ""
  ) {
    return invalid("invalid-request");
  }

  const version = request.headers.get(COLLAB_GATEWAY_AUTH_HEADERS.version);
  const keyId = request.headers.get(COLLAB_GATEWAY_AUTH_HEADERS.keyId);
  const timestampValue = request.headers.get(
    COLLAB_GATEWAY_AUTH_HEADERS.timestamp,
  );
  const nonce = request.headers.get(COLLAB_GATEWAY_AUTH_HEADERS.nonce);
  const signature = request.headers.get(COLLAB_GATEWAY_AUTH_HEADERS.signature);
  const webSocketKey = request.headers.get("sec-websocket-key");

  if (
    version !== AUTH_VERSION ||
    keyId === null ||
    !KEY_ID_PATTERN.test(keyId) ||
    timestampValue === null ||
    nonce === null ||
    signature === null ||
    webSocketKey === null ||
    decodeUnpaddedBase64Url(nonce, NONCE_BYTE_LENGTH) === null ||
    decodeUnpaddedBase64Url(signature, SIGNATURE_BYTE_LENGTH) === null ||
    !isValidWebSocketKey(webSocketKey)
  ) {
    return invalid("invalid-headers");
  }

  const timestamp = parseTimestamp(timestampValue);
  if (timestamp === null) return invalid("invalid-headers");
  if (
    !Number.isSafeInteger(nowSeconds) ||
    Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS
  ) {
    return invalid("expired");
  }

  const secret = keyring.get(keyId);
  if (secret === undefined) return invalid("unknown-key");
  if (secret.byteLength !== KEY_BYTE_LENGTH)
    return invalid("invalid-signature");

  const canonicalPayload = buildCollabGatewayCanonicalPayload({
    keyId,
    timestamp: timestampValue,
    nonce,
    method: request.method,
    path: url.pathname,
    webSocketKey,
  });
  const expectedSignature = Buffer.from(
    createSignature(secret, canonicalPayload),
    "base64url",
  );
  const actualSignature = Buffer.from(signature, "base64url");
  if (
    actualSignature.byteLength !== expectedSignature.byteLength ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return invalid("invalid-signature");
  }

  return { ok: true, keyId };
};
