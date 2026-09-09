/** Test seeding is opt-in; local seeding must target both a local app and DB. */
export const isLoopbackUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
};

export const allowsLocalSeed = (
  environment: Readonly<Record<string, string | undefined>>,
  requestUrl: string,
): boolean =>
  environment.NODE_ENV !== "production" &&
  environment.E2E_ALLOW_LOCAL_SEED === "true" &&
  isLoopbackUrl(requestUrl) &&
  isLoopbackUrl(environment.NEXT_PUBLIC_SUPABASE_URL ?? "");
