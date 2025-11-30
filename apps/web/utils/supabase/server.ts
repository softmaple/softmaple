import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import type { Database } from "@/types/model";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMockSupabaseClient } from "./mockClient";

export const createClient = async (
  cookieStore?: ReturnType<typeof cookies>,
): Promise<SupabaseClient<Database>> => {
  // E2E Test Mode: Return a mock client when in test mode
  if (process.env.NEXT_PUBLIC_E2E_TEST_MODE === "true") {
    const headersList = await headers();
    const testUser = headersList.get("x-e2e-test-user");
    if (testUser) {
      try {
        const userData = JSON.parse(testUser);
        // Return a properly typed mock Supabase client
        return createMockSupabaseClient(userData);
      } catch (e) {
        // Fall through to normal client creation
      }
    }
  }

  const cookieStore_ = cookieStore ?? cookies();
  const { getAll, set } = await cookieStore_;

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    },
  );
};
