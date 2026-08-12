/** Shared browser-origin allowlist check for every WebSocket upgrade route. */
export const isAllowedOrigin = (request: Request, env: Env): boolean => {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  const allowed = env.COLLAB_ALLOWED_ORIGINS.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return allowed.includes(origin);
};
