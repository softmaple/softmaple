import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("should navigate between main pages", async ({ page }) => {
    await page.goto("/");

    // Navigate to login via Sign In button
    await page.getByRole("button", { name: /Sign In/i }).click();
    await expect(page).toHaveURL("/login");

    // Navigate back home via Softmaple text/logo
    await page.locator("header").getByText("Softmaple").click();
    await expect(page).toHaveURL("/");

    // Navigate to signup via login page
    await page.goto("/login");
    await page.getByRole("link", { name: /Sign up/i }).click();
    await expect(page).toHaveURL("/signup");
  });

  test("should handle 404 pages", async ({ page }) => {
    await page.goto("/non-existent-page");

    // Should show 404 page
    await expect(page.getByText(/404/)).toBeVisible();
    await expect(page.getByText(/Page not found/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Go Home/i })).toBeVisible();
  });

  test("should handle coming soon pages", async ({ page }) => {
    await page.goto("/coming-soon");

    await expect(
      page.getByRole("heading", { name: /Coming Soon/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/This feature is under development/i),
    ).toBeVisible();
  });

  test("should have working breadcrumbs", async ({ page }) => {
    // Mock auth to access workspace
    await page.addInitScript(
      (storageKey) => {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            access_token: "mock-token",
            refresh_token: "mock-refresh",
            expires_at: Date.now() + 3600000,
            user: { id: "test-user-id", email: "test@example.com" },
          }),
        );
      },
      // Pass storage key dynamically based on environment
      process.env.NEXT_PUBLIC_SUPABASE_URL
        ? `sb-${process.env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || "localhost"}-auth-token`
        : "sb-iouhcoutiwcrwqszrecj-auth-token",
    );

    await page.goto("/workspace/test-workspace/doc/test-doc");

    // Check breadcrumbs
    const breadcrumbs = page.getByRole("navigation", { name: /breadcrumb/i });
    await expect(breadcrumbs.getByText(/Dashboard/i)).toBeVisible();
    await expect(breadcrumbs.getByText(/test-workspace/i)).toBeVisible();
    await expect(breadcrumbs.getByText(/test-doc/i)).toBeVisible();

    // Click workspace breadcrumb
    await breadcrumbs.getByText(/test-workspace/i).click();
    await expect(page).toHaveURL("/workspace/test-workspace");
  });

  test("should handle browser back/forward navigation", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Login" }).click();
    await page.getByRole("link", { name: "Sign up" }).click();

    // Go back
    await page.goBack();
    await expect(page).toHaveURL("/login");

    // Go back again
    await page.goBack();
    await expect(page).toHaveURL("/");

    // Go forward
    await page.goForward();
    await expect(page).toHaveURL("/login");
  });

  test("should preserve query parameters", async ({ page }) => {
    await page.goto("/login?redirect=/dashboard");

    // Check query param is preserved
    await expect(page).toHaveURL(/redirect=\/dashboard/);

    // Navigate to signup with query param
    await page
      .getByText(/Don't have an account/i)
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(/\/signup/);
  });

  test("should handle deep links", async ({ page }) => {
    // Mock auth
    await page.addInitScript(
      (storageKey) => {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            access_token: "mock-token",
            refresh_token: "mock-refresh",
            expires_at: Date.now() + 3600000,
            user: { id: "test-user-id", email: "test@example.com" },
          }),
        );
      },
      // Pass storage key dynamically based on environment
      process.env.NEXT_PUBLIC_SUPABASE_URL
        ? `sb-${process.env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || "localhost"}-auth-token`
        : "sb-iouhcoutiwcrwqszrecj-auth-token",
    );

    // Direct deep link to document
    await page.goto("/workspace/test-workspace/doc/test-doc#section-2");

    // Should load the page with hash
    await expect(page).toHaveURL(/test-doc#section-2/);
  });
});

test.describe("Responsive Navigation", () => {
  test("should toggle mobile menu", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    // Mobile menu should be hidden initially
    const mobileNav = page.getByRole("navigation", { name: /mobile/i });
    await expect(mobileNav).toBeHidden();

    // Click hamburger menu
    await page.getByRole("button", { name: /menu/i }).click();

    // Mobile menu should be visible
    await expect(mobileNav).toBeVisible();

    // Click close button
    await page.getByRole("button", { name: /close/i }).click();

    // Mobile menu should be hidden again
    await expect(mobileNav).toBeHidden();
  });

  test("should close mobile menu on navigation", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    // Open mobile menu
    await page.getByRole("button", { name: /menu/i }).click();
    const mobileNav = page.getByRole("navigation", { name: /mobile/i });
    await expect(mobileNav).toBeVisible();

    // Click a link
    await mobileNav.getByRole("link", { name: "Login" }).click();

    // Menu should close and navigate
    await expect(page).toHaveURL("/login");
    await expect(mobileNav).toBeHidden();
  });

  test("should handle tablet viewport", async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");

    // Check layout adjustments for tablet
    const header = page.getByRole("banner");
    await expect(header).toBeVisible();

    // Navigation should be visible (not in hamburger)
    await expect(page.getByRole("link", { name: "Login" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible();
  });
});

test.describe("Keyboard Navigation", () => {
  test("should be navigable with keyboard", async ({ page }) => {
    await page.goto("/");

    // Tab through elements
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link").first()).toBeFocused();

    // Continue tabbing
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    // Press Enter on focused link
    await page.keyboard.press("Enter");

    // Should navigate
    await expect(page).not.toHaveURL("/");
  });

  test("should handle escape key for modals", async ({ page }) => {
    // Mock auth
    await page.addInitScript(
      (storageKey) => {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            access_token: "mock-token",
            refresh_token: "mock-refresh",
            expires_at: Date.now() + 3600000,
            user: { id: "test-user-id", email: "test@example.com" },
          }),
        );
      },
      // Pass storage key dynamically based on environment
      process.env.NEXT_PUBLIC_SUPABASE_URL
        ? `sb-${process.env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || "localhost"}-auth-token`
        : "sb-iouhcoutiwcrwqszrecj-auth-token",
    );

    await page.goto("/workspace/test-workspace");

    // Open a modal (e.g., create document)
    await page.getByRole("button", { name: /Create Document/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Press Escape
    await page.keyboard.press("Escape");

    // Modal should close
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("should support keyboard shortcuts", async ({ page }) => {
    // Mock auth
    await page.addInitScript(
      (storageKey) => {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            access_token: "mock-token",
            refresh_token: "mock-refresh",
            expires_at: Date.now() + 3600000,
            user: { id: "test-user-id", email: "test@example.com" },
          }),
        );
      },
      // Pass storage key dynamically based on environment
      process.env.NEXT_PUBLIC_SUPABASE_URL
        ? `sb-${process.env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || "localhost"}-auth-token`
        : "sb-iouhcoutiwcrwqszrecj-auth-token",
    );

    await page.goto("/workspace/test-workspace/doc/test-doc");

    // Test Ctrl+S for save
    await page.keyboard.press("Control+S");
    await expect(page.getByText(/Saved/i)).toBeVisible({ timeout: 5000 });

    // Test Ctrl+/ for search
    await page.keyboard.press("Control+/");
    await expect(page.getByPlaceholder(/Search/i)).toBeFocused();
  });
});
