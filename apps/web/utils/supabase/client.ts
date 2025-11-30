"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/model";
import type { SupabaseClient } from "@supabase/supabase-js";

export const createClient = (): SupabaseClient<Database> => {
  // E2E Test Mode: Return a mock client when in test mode
  if (process.env.NEXT_PUBLIC_E2E_TEST_MODE === "true") {
    // Check if we have test user data in localStorage
    if (typeof window !== "undefined") {
      const testUserCookie = document.cookie
        .split("; ")
        .find((row) => row.startsWith("e2e-test-user="));

      if (testUserCookie) {
        try {
          // Find the first "=" and take everything after it
          const equalIndex = testUserCookie.indexOf("=");
          let cookieValue = "";

          if (equalIndex !== -1) {
            // Take substring after the first "="
            cookieValue = testUserCookie.substring(equalIndex + 1);
          }

          // Decode and parse with error handling
          let userData = null;
          if (cookieValue) {
            try {
              userData = JSON.parse(decodeURIComponent(cookieValue));
            } catch (parseError) {
              console.warn("Failed to parse e2e-test-user cookie:", parseError);
              // Fall through to normal client if cookie data is invalid
            }
          }

          if (!userData) {
            // Fall through to normal client if no valid user data
            throw new Error("No valid user data in cookie");
          }

          // Return a mock Supabase client
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
              onAuthStateChange: (callback: any) => {
                // Immediately trigger with test user
                if (callback) {
                  callback("SIGNED_IN", {
                    access_token: "test-token",
                    user: userData,
                  });
                }
                return {
                  data: { subscription: { unsubscribe: () => {} } },
                };
              },
              signOut: async () => ({ error: null }),
            },
            from: (table: string) => ({
              select: <T = any>() => ({
                maybeSingle: async () => ({ data: {}, error: null }),
                single: async () => ({ data: {}, error: null }),
                then: async () => [],
              }),
              insert: (data: any) => ({
                select: <T = any>() => ({
                  maybeSingle: async () => ({
                    data: { id: "mock-id", ...data },
                    error: null,
                  }),
                  single: async () => ({ data: {}, error: null }),
                }),
              }),
              upsert: (data: any) => ({
                select: <T = any>() => ({
                  maybeSingle: async () => ({
                    data: { id: "mock-id", ...data },
                    error: null,
                  }),
                  single: async () => ({ data: {}, error: null }),
                }),
              }),
              update: () => ({
                eq: () => ({
                  select: <T = any>() => ({
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
          // Fall through to normal client
        }
      }
    }
  }

  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
};
