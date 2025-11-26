import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("should display landing page with auth options", async ({ page }) => {
    await page.goto("/");

    // Check for Softmaple branding
    await expect(page.getByText("Softmaple")).toBeVisible();

    // Check for Sign In button in header
    await expect(page.getByRole("button", { name: /Sign In/i })).toBeVisible();
  });

  test("should navigate to login page", async ({ page }) => {
    await page.goto("/");

    // Click Sign In button
    await page.getByRole("button", { name: /Sign In/i }).click();

    // Verify we're on the login page
    await expect(page).toHaveURL("/login");
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await expect(
      page.getByText("Sign in to your Softmaple account"),
    ).toBeVisible();

    // Check form fields
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();

    // Check submit button (it's actually labeled "Continue")
    await expect(page.getByRole("button", { name: /Continue/i })).toBeVisible();

    // Check social login buttons
    await expect(page.getByRole("button", { name: /GitHub/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();
  });

  test("should navigate to signup page from login", async ({ page }) => {
    await page.goto("/login");

    // Click sign up link from login page
    await page.getByRole("link", { name: /Sign up/i }).click();

    // Verify we're on the signup page
    await expect(page).toHaveURL("/signup");
    await expect(
      page.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
    await expect(
      page.getByText("Start writing with Softmaple today"),
    ).toBeVisible();

    // Check form fields
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();

    // Check submit button
    await expect(page.getByRole("button", { name: /Continue/i })).toBeVisible();

    // Check social login buttons
    await expect(page.getByRole("button", { name: /GitHub/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();
  });

  test("should validate required fields on login form", async ({ page }) => {
    await page.goto("/login");

    // Try to submit empty form
    await page.getByRole("button", { name: /Continue/i }).click();

    // HTML5 validation should prevent submission
    // Check that we're still on login page
    await expect(page).toHaveURL("/login");

    // Check that fields have required attribute
    await expect(page.getByLabel("Email")).toHaveAttribute("required", "");
    await expect(page.getByLabel("Password")).toHaveAttribute("required", "");
  });

  test("should validate email format", async ({ page }) => {
    await page.goto("/login");

    // Enter invalid email
    const emailInput = page.getByLabel("Email");
    await emailInput.fill("invalid-email");
    await page.getByLabel("Password").fill("password123");

    // Try to submit
    await page.getByRole("button", { name: /Continue/i }).click();

    // HTML5 email validation should trigger
    const validityState = await emailInput.evaluate(
      (el: HTMLInputElement) => el.validity.valid,
    );
    expect(validityState).toBe(false);
  });

  test("should have link from login to signup", async ({ page }) => {
    await page.goto("/login");

    // Check for signup text and link
    await expect(page.getByText("Don't have an account?")).toBeVisible();
    const signupLink = page.getByRole("link", { name: /Sign up/i });
    await expect(signupLink).toBeVisible();

    // Click the link
    await signupLink.click();

    // Verify navigation to signup
    await expect(page).toHaveURL("/signup");
  });

  test("should have link from signup to login", async ({ page }) => {
    await page.goto("/signup");

    // Check for login text and link
    await expect(page.getByText("Already have an account?")).toBeVisible();
    const signinLink = page.getByRole("link", { name: /Sign in/i });
    await expect(signinLink).toBeVisible();

    // Click the link
    await signinLink.click();

    // Verify navigation to login
    await expect(page).toHaveURL("/login");
  });

  test("should display logo and branding on auth pages", async ({ page }) => {
    // Check login page branding
    await page.goto("/login");

    // Look for the logo (orange-red gradient div with FileText icon)
    const loginLogo = page.locator(
      ".w-12.h-12.bg-gradient-to-br.from-orange-500.to-red-500",
    );
    await expect(loginLogo).toBeVisible();

    // Check signup page branding
    await page.goto("/signup");
    const signupLogo = page.locator(
      ".w-12.h-12.bg-gradient-to-br.from-orange-500.to-red-500",
    );
    await expect(signupLogo).toBeVisible();
  });

  test("should show 'Or continue with' divider", async ({ page }) => {
    await page.goto("/login");

    // Check for social login divider
    await expect(page.getByText("Or continue with")).toBeVisible();

    // Same for signup page
    await page.goto("/signup");
    await expect(page.getByText("Or continue with")).toBeVisible();
  });

  test("should fill and submit login form", async ({ page }) => {
    await page.goto("/login");

    // Fill in the form
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("testpassword123");

    // The form should be submittable (though it may fail with test credentials)
    const submitButton = page.getByRole("button", { name: /Continue/i });
    await expect(submitButton).toBeEnabled();
  });

  test("should handle authenticated user redirect", async ({ page }) => {
    // If user is already authenticated, they should see Dashboard button instead of Sign In
    // This test would require mocking authentication

    // For now, just check that unauthenticated users see Sign In
    await page.goto("/");
    const headerButton = page
      .getByRole("button")
      .filter({ hasText: /Sign In|Dashboard/i });
    const buttonText = await headerButton.textContent();

    // Should be "Sign In" for unauthenticated users
    expect(buttonText).toContain("Sign In");
  });
});
