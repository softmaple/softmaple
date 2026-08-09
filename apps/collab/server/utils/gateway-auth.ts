import {
  hasCollabGatewayAuthHeaders,
  parseCollabGatewayKeyring,
  verifyCollabGatewayAuthRequest,
} from "@softmaple/collab-gateway-auth";

const legacyAllowedOrigins = (): ReadonlySet<string> => {
  const configured = process.env.COLLAB_ALLOWED_ORIGINS;
  if (!configured) return new Set();
  return new Set(
    configured
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
};

const rejectUpgrade = (mode: "hmac" | "legacy", reason: string): never => {
  console.warn("Collaboration gateway upgrade rejected", { mode, reason });
  throw new Response("Forbidden", { status: 403 });
};

export const authenticateGatewayUpgrade = (
  request: Request,
): Readonly<Record<string, unknown>> => {
  if (hasCollabGatewayAuthHeaders(request.headers)) {
    let verification;
    try {
      const keyring = parseCollabGatewayKeyring(
        process.env.COLLAB_GATEWAY_HMAC_KEYS,
      );
      verification = verifyCollabGatewayAuthRequest(request, keyring);
    } catch {
      return rejectUpgrade("hmac", "invalid-configuration");
    }
    if (!verification.ok) {
      return rejectUpgrade("hmac", verification.reason);
    }
    return Object.freeze({
      gatewayAuthMode: "hmac",
      gatewayAuthKeyId: verification.keyId,
    });
  }

  if (process.env.COLLAB_GATEWAY_HMAC_KEYS !== undefined) {
    try {
      parseCollabGatewayKeyring(process.env.COLLAB_GATEWAY_HMAC_KEYS);
    } catch {
      return rejectUpgrade("legacy", "invalid-configuration");
    }
  }

  const origin = request.headers.get("origin");
  if (origin === null || !legacyAllowedOrigins().has(origin)) {
    return rejectUpgrade("legacy", "origin-not-allowed");
  }
  console.warn("Collaboration gateway upgrade accepted in legacy mode");
  return Object.freeze({ gatewayAuthMode: "legacy" });
};
