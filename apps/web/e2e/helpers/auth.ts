import { Page } from "@playwright/test";

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

  await page.addInitScript(
    (data) => {
      localStorage.setItem(
        "supabase.auth.token",
        JSON.stringify({
          access_token: `mock-token-${data.userId}`,
          refresh_token: `mock-refresh-${data.userId}`,
          expires_at: Date.now() + 3600000,
          user: {
            id: data.userId,
            email: data.email,
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      );
    },
    { userId, email },
  );
}
