import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("should display landing page", async ({ page }) => {
    await page.goto("/");

    // Check for main landing page elements
    await expect(page).toHaveTitle(/SoftMaple/);
    await expect(page.getByRole("link", { name: "Login" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible();
  });

  test("should navigate to login page", async ({ page }) => {
    await page.goto("/");

    // Click login link
    await page.getByRole("link", { name: "Login" }).click();

    // Verify we're on the login page
    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("heading", { name: /Log in/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Log in/i })).toBeVisible();
  });

  test("should navigate to signup page", async ({ page }) => {
    await page.goto("/");

    // Click sign up link
    await page.getByRole("link", { name: "Sign up" }).click();

    // Verify we're on the signup page
    await expect(page).toHaveURL("/signup");
    await expect(page.getByRole("heading", { name: /Sign up/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign up/i })).toBeVisible();
  });

  test("should show validation errors for empty login form", async ({
    page,
  }) => {
    await page.goto("/login");

    // Try to submit empty form
    await page.getByRole("button", { name: /Log in/i }).click();

    // Check for validation messages
    await expect(page.getByText(/required/i).first()).toBeVisible();
  });

  test("should show validation errors for invalid email", async ({ page }) => {
    await page.goto("/login");

    // Enter invalid email
    await page.getByLabel(/email/i).fill("invalid-email");
    await page.getByLabel(/password/i).fill("password123");
    await page.getByRole("button", { name: /Log in/i }).click();

    // Check for email validation message
    await expect(page.getByText(/invalid email/i)).toBeVisible();
  });

  test("should have link from login to signup", async ({ page }) => {
    await page.goto("/login");

    // Find and click the sign up link
    await page
      .getByText(/Don't have an account/i)
      .getByRole("link")
      .click();

    // Verify navigation to signup
    await expect(page).toHaveURL("/signup");
  });

  test("should have link from signup to login", async ({ page }) => {
    await page.goto("/signup");

    // Find and click the login link
    await page
      .getByText(/Already have an account/i)
      .getByRole("link")
      .click();

    // Verify navigation to login
    await expect(page).toHaveURL("/login");
  });
});
