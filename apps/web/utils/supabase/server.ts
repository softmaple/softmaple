import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import type { Database } from "@/types/model";
import type { SupabaseClient } from "@supabase/supabase-js";

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
            select: <T = any>() => {
              const chainObj: any = {
                eq: (column: string, value: any) => chainObj,
                order: (column: string, options: any) => chainObj,
                limit: (count: number) => chainObj,
                maybeSingle: async () => ({
                  data: {
                    id: "mock-id",
                    slug: "test-workspace",
                    name: "Test Workspace",
                  },
                  error: null,
                }),
                single: async () => ({
                  data: {
                    id: "mock-id",
                    slug: "test-workspace",
                    name: "Test Workspace",
                  },
                  error: null,
                }),
                then: async () => [
                  {
                    id: "mock-id",
                    slug: "test-workspace",
                    name: "Test Workspace",
                  },
                ],
              };
              return chainObj;
            },
            insert: () => ({
              select: <T = any>() => ({
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
