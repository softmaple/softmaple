/**
 * Smoke tests - Critical path tests that must pass
 * These run first and fast in CI
 */
import { test, expect } from "@playwright/test";
import { mockAuthentication } from "./helpers/auth";

test.describe("Smoke Tests", () => {
  test("landing page loads", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Softmaple/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /Sign in/i })).toBeVisible();
  });

  test("authenticated user can access dashboard", async ({ page }) => {
    await mockAuthentication(page);
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/dashboard");
  });

  test("authenticated user can access workspace", async ({ page }) => {
    await mockAuthentication(page);
    await page.goto("/workspace/test-workspace");
    await expect(page).toHaveURL("/workspace/test-workspace");
  });

  test("unauthenticated user redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/login");
  });
});
