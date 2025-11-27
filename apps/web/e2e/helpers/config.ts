/**
 * Test configuration that works in both local and CI environments
 */
export const testConfig = {
  // Extract project reference from Supabase URL
  // In CI, this comes from secrets; locally from .env file
  getSupabaseProjectRef(): string {
    const url =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "https://iouhcoutiwcrwqszrecj.supabase.co";
    const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
    return match?.[1] || "localhost";
  },

  getSupabaseStorageKey(): string {
    return `sb-${testConfig.getSupabaseProjectRef()}-auth-token`;
  },
};
