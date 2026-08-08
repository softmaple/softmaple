"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/model";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMockSupabaseClient } from "./mockClient";

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

          // Return a properly typed mock Supabase client
          return createMockSupabaseClient(userData);
        } catch {
          // Fall through to normal client
        }
      }
    }
  }

  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
  );
};
