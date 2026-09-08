/**
 * Deciding whether a seed request may run at all.
 *
 * Seeding creates confirmed users and writes workspace rows with the service
 * role key, so the guard is deliberately a whitelist of two shapes and nothing
 * else:
 *
 * - a **remote** isolated Playwright project, which must be named explicitly by
 *   `E2E_SUPABASE_PROJECT_REF`, must match the configured Supabase URL, and
 *   must not be the production project; or
 * - a **local** stack on loopback, which must be opted into separately and can
 *   only ever address 127.0.0.1 / localhost.
 *
 * Neither switch implies the other: turning on local seeding cannot loosen the
 * remote checks, and a misconfigured remote project can never fall through to
 * the local branch. Anything else is refused.
 */

export const SEED_ISOLATION = {
  Local: "local",
  Remote: "remote",
} as const;

export type SeedIsolation =
  (typeof SEED_ISOLATION)[keyof typeof SEED_ISOLATION];

export type SeedEnvironment = Readonly<Record<string, string | undefined>>;

export type SeedConfiguration = {
  readonly isolation: SeedIsolation;
  readonly seedSecret: string;
  readonly serviceRoleKey: string;
  readonly url: string;
};

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** The Supabase project ref for a hosted `*.supabase.co` URL, else `null`. */
export const projectRefFromUrl = (value: string): string | null => {
  try {
    const [projectRef, ...rest] = new URL(value).hostname.split(".");
    return rest.join(".") === "supabase.co" && projectRef ? projectRef : null;
  } catch {
    return null;
  }
};

/** True only for a URL whose host cannot leave the machine. */
export const isLoopbackUrl = (value: string): boolean => {
  try {
    const { hostname } = new URL(value);
    return LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
};

const isEnabled = (value: string | undefined): boolean => value === "true";

/**
 * Resolve the seeding configuration, or throw. Callers translate the throw
 * into a 404 so an unconfigured deployment does not advertise the route.
 */
export const resolveSeedConfiguration = (
  environment: SeedEnvironment,
): SeedConfiguration => {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  const seedSecret = environment.E2E_SEED_SECRET;
  if (
    url === undefined ||
    serviceRoleKey === undefined ||
    seedSecret === undefined
  ) {
    throw new Error("E2E seed configuration is not safely isolated");
  }

  if (isEnabled(environment.E2E_ALLOW_LOCAL_SEED) && isLoopbackUrl(url)) {
    return {
      isolation: SEED_ISOLATION.Local,
      seedSecret,
      serviceRoleKey,
      url,
    };
  }

  const expectedProjectRef = environment.E2E_SUPABASE_PROJECT_REF;
  const actualProjectRef = projectRefFromUrl(url);
  if (
    !isEnabled(environment.E2E_ALLOW_REMOTE_SEED) ||
    expectedProjectRef === undefined ||
    actualProjectRef !== expectedProjectRef ||
    actualProjectRef === environment.SUPABASE_PRODUCTION_PROJECT_REF
  ) {
    throw new Error("E2E seed configuration is not safely isolated");
  }
  return {
    isolation: SEED_ISOLATION.Remote,
    seedSecret,
    serviceRoleKey,
    url,
  };
};
