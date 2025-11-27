/**
 * Test configuration that works in both local and CI environments
 */
export const testConfig = {
  // Extract project reference from Supabase URL
  // In CI, this comes from secrets; locally from .env file
  getSupabaseProjectRef(): string {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL is not set. Please configure environment variables for E2E tests.",
      );
    }
    const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
    if (!match?.[1]) {
      throw new Error(
        `Invalid NEXT_PUBLIC_SUPABASE_URL format: ${url}. Expected format: https://<project-ref>.supabase.co`,
      );
    }
    return match[1];
  },

  getProjectRef(): string {
    return testConfig.getSupabaseProjectRef();
  },

  getSupabaseStorageKey(): string {
    return `sb-${testConfig.getSupabaseProjectRef()}-auth-token`;
  },
};
