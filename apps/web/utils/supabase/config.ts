export interface SupabasePublicConfig {
  readonly publishableKey: string;
  readonly url: string;
}

export const resolveSupabasePublicConfig = (): SupabasePublicConfig => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and a Supabase publishable key are required",
    );
  }

  return { publishableKey, url };
};
