import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import type { Database } from "@/types/model";

export const createClient = async (
  cookieStore?: ReturnType<typeof cookies>,
) => {
  // E2E Test Mode: Return a mock client when in test mode
  if (process.env.NEXT_PUBLIC_E2E_TEST_MODE === "true") {
    const headersList = await headers();
    const testUser = headersList.get("x-e2e-test-user");
    if (testUser) {
      try {
        const userData = JSON.parse(testUser);
        // Return a mock Supabase client that returns test data
        return {
          auth: {
            getUser: async () => ({
              data: { user: userData },
              error: null,
            }),
            getSession: async () => ({
              data: {
                session: {
                  access_token: "test-token",
                  refresh_token: "test-refresh",
                  expires_at: Math.floor(Date.now() / 1000) + 3600,
                  user: userData,
                },
              },
              error: null,
            }),
            signOut: async () => ({ error: null }),
            signInWithPassword: async () => ({
              data: { user: userData, session: {} },
              error: null,
            }),
          },
          from: () => ({
            select: () => ({
              single: async () => ({ data: {}, error: null }),
              then: async () => [],
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({ data: {}, error: null }),
              }),
            }),
            update: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({ data: {}, error: null }),
                }),
              }),
            }),
            delete: () => ({
              eq: () => ({ then: async () => ({}) }),
            }),
          }),
        } as any;
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
