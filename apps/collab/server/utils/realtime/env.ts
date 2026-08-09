export const CollabRealtimeDriver = {
  Memory: "memory",
  Redis: "redis",
} as const;

export type CollabRealtimeDriver =
  (typeof CollabRealtimeDriver)[keyof typeof CollabRealtimeDriver];

export class CollabRealtimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollabRealtimeConfigError";
  }
}

const isVercelDeployedRuntime = (env: NodeJS.ProcessEnv): boolean =>
  env.VERCEL === "1" ||
  env.VERCEL_ENV === "production" ||
  env.VERCEL_ENV === "preview";

export const resolveCollabRealtimeDriver = (
  env: NodeJS.ProcessEnv = process.env,
): CollabRealtimeDriver => {
  const configured = env.COLLAB_REALTIME_DRIVER?.trim().toLowerCase();
  const onVercel = isVercelDeployedRuntime(env);

  if (configured === CollabRealtimeDriver.Memory) {
    if (onVercel) {
      throw new CollabRealtimeConfigError(
        "COLLAB_REALTIME_DRIVER=memory is not allowed on Vercel deployments",
      );
    }
    return CollabRealtimeDriver.Memory;
  }

  if (configured === CollabRealtimeDriver.Redis) {
    return CollabRealtimeDriver.Redis;
  }

  if (configured !== undefined && configured.length > 0) {
    throw new CollabRealtimeConfigError(
      'COLLAB_REALTIME_DRIVER must be "memory" or "redis"',
    );
  }

  // Deployed Vercel runtimes must coordinate through Redis. Local development
  // and unit tests default to the in-memory adapter.
  if (onVercel) return CollabRealtimeDriver.Redis;
  return CollabRealtimeDriver.Memory;
};

export const resolveRedisUrl = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const redisUrl = env.REDIS_URL?.trim();
  if (redisUrl === undefined || redisUrl.length === 0) {
    throw new CollabRealtimeConfigError(
      "REDIS_URL is required when collab realtime uses Redis",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch {
    throw new CollabRealtimeConfigError("REDIS_URL must be a valid URL");
  }
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new CollabRealtimeConfigError(
      "REDIS_URL must use redis:// or rediss://",
    );
  }
  return redisUrl;
};
