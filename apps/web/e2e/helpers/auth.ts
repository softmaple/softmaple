import { Page } from "@playwright/test";

interface MockUser {
  userId?: string;
  email?: string;
}

/**
 * Mock authentication for E2E tests using test mode bypass
 * @param page - The Playwright page object
 * @param user - Optional user data to customize the mock user
 */
export async function mockAuthentication(page: Page, user: MockUser = {}) {
  const { userId = "test-user-id", email = "test@example.com" } = user;

  // Create mock user data for test mode
  const userData = {
    id: userId,
    email: email,
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    role: "authenticated",
    aud: "authenticated",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Get the domain from the current page URL or default to localhost
  const domain = page.url().startsWith("http")
    ? new URL(page.url()).hostname
    : "localhost";

  // Set test user cookie that the middleware will recognize
  await page.context().addCookies([
    {
      name: "e2e-test-user",
      value: JSON.stringify(userData),
      domain: domain,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 3600,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}
