import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/model";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSupabasePublicConfig } from "./config";

export const createClient = async (
  cookieStore?: ReturnType<typeof cookies>,
): Promise<SupabaseClient<Database>> => {
  const cookieStore_ = cookieStore ?? cookies();
  const { getAll, set } = await cookieStore_;
  const { publishableKey, url } = resolveSupabasePublicConfig();

  return createServerClient<Database>(url, publishableKey, {
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
  });
};
