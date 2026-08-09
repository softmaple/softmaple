/**
 * Browser Origin validation for direct WebSocket upgrades to apps/collab.
 * Replaces the former HMAC gateway trust boundary: user auth remains JWT +
 * membership checks inside each session.
 */

const tryOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const configuredOrigins = (
  env: NodeJS.ProcessEnv = process.env,
): ReadonlySet<string> => {
  const origins = new Set<string>();
  const configured = env.COLLAB_ALLOWED_ORIGINS;
  if (configured) {
    for (const origin of configured.split(",")) {
      const trimmed = origin.trim();
      if (trimmed.length === 0) continue;
      const normalized = tryOrigin(trimmed);
      if (normalized !== null) origins.add(normalized);
    }
  }
  for (const key of [
    "VERCEL_URL",
    "VERCEL_BRANCH_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
  ] as const) {
    const host = env[key]?.trim();
    if (host === undefined || host.length === 0) continue;
    const normalized = tryOrigin(
      host.startsWith("http") ? host : `https://${host}`,
    );
    if (normalized !== null) origins.add(normalized);
  }
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim() || env.APP_ORIGIN?.trim();
  if (appUrl) {
    const normalized = tryOrigin(appUrl);
    if (normalized !== null) origins.add(normalized);
  }
  return origins;
};

const rejectUpgrade = (reason: string): never => {
  console.warn("Collaboration upgrade rejected", { reason });
  throw new Response("Forbidden", { status: 403 });
};

export const authenticateBrowserOrigin = (
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): Readonly<Record<string, unknown>> => {
  const allowed = configuredOrigins(env);
  if (allowed.size === 0) {
    return rejectUpgrade("origins-not-configured");
  }
  const origin = request.headers.get("origin");
  if (origin === null || origin === "null") {
    return rejectUpgrade("origin-missing");
  }
  let parsedOrigin: string;
  try {
    parsedOrigin = new URL(origin).origin;
  } catch {
    return rejectUpgrade("origin-invalid");
  }
  if (parsedOrigin !== origin || !allowed.has(parsedOrigin)) {
    return rejectUpgrade("origin-not-allowed");
  }
  return Object.freeze({
    browserOrigin: parsedOrigin,
  });
};
