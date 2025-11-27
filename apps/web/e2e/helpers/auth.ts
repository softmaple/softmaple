import { Page } from "@playwright/test";
import { testConfig } from "./config";

interface MockUser {
  userId?: string;
  email?: string;
}

/**
 * Mock authentication for E2E tests by setting Supabase auth token in localStorage
 * @param page - The Playwright page object
 * @param user - Optional user data to customize the mock user
 */
export async function mockAuthentication(page: Page, user: MockUser = {}) {
  const { userId = "test-user-id", email = "test@example.com" } = user;

  // Use the centralized config to get the storage key
  const storageKey = testConfig.getSupabaseStorageKey();

  await page.addInitScript(
    ({ userId, email, storageKey }) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          access_token: `mock-token-${userId}`,
          refresh_token: `mock-refresh-${userId}`,
          expires_at: Date.now() + 3600000,
          user: {
            id: userId,
            email: email,
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      );
    },
    { userId, email, storageKey },
  );
}
