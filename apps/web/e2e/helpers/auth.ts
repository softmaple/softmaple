import { Page } from "@playwright/test";
import { testConfig } from "./config";

interface MockUser {
  userId?: string;
  email?: string;
}

/**
 * Mock authentication for E2E tests by setting Supabase auth token in localStorage and cookies
 * @param page - The Playwright page object
 * @param user - Optional user data to customize the mock user
 */
export async function mockAuthentication(page: Page, user: MockUser = {}) {
  const { userId = "test-user-id", email = "test@example.com" } = user;

  // Use the centralized config to get the storage key
  const storageKey = testConfig.getSupabaseStorageKey();
  const projectRef = testConfig.getProjectRef();

  // Create mock session data
  const sessionData = {
    access_token: `mock-token-${userId}`,
    refresh_token: `mock-refresh-${userId}`,
    expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: userId,
      email: email,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      role: "authenticated",
      aud: "authenticated",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };

  // Set cookies that Supabase server-side expects
  // We need to navigate to the app first so cookies are set for the correct domain
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.context().addCookies([
    {
      name: `sb-${projectRef}-auth-token`,
      value: Buffer.from(JSON.stringify(sessionData)).toString("base64url"),
      domain: "localhost",
      path: "/",
      expires: sessionData.expires_at,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  // Also set localStorage for client-side checks
  await page.evaluate(
    ({ storageKey, sessionData }) => {
      localStorage.setItem(storageKey, JSON.stringify(sessionData));
    },
    { storageKey, sessionData },
  );

  // Wait a bit for the auth state to propagate
  await page.waitForTimeout(100);

  // Reload to ensure the auth is picked up
  await page.reload();
}
