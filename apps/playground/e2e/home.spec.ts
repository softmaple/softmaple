import { test, expect } from "@playwright/test";

test.describe("Home Page", () => {
  test("should load home page successfully", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check title
    await expect(page).toHaveTitle(/SoftMaple Playground/);

    // Check main heading
    await expect(
      page.getByRole("heading", { name: /SoftMaple Playground/i }),
    ).toBeVisible();
  });

  test("should display feature cards", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check for Two-Panel Text Editor card
    await expect(
      page.getByRole("heading", { name: /Two-Panel Text Editor/i }),
    ).toBeVisible();

    // Check for Collaborative Editor card
    await expect(
      page.getByRole("heading", { name: /Collaborative Text Editor/i }),
    ).toBeVisible();
  });

  test("should navigate to two-panel editor", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Click on Two-Panel Text Editor card
    await page.getByRole("link", { name: /Two-Panel Text Editor/i }).click();

    // Verify navigation
    await expect(page).toHaveURL(/\/demo\/two-panel-editor/);
    await expect(
      page.getByRole("heading", { name: /Two-Panel Text Editor/i }),
    ).toBeVisible();
  });

  test("should navigate to collaborative editor", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Click on Collaborative Editor card
    await page
      .getByRole("link", { name: /Collaborative Text Editor/i })
      .click();

    // Verify navigation
    await expect(page).toHaveURL(/\/demo\/collaborative-editor/);
    await expect(
      page.getByRole("heading", { name: /Collaborative Text Editor/i }),
    ).toBeVisible();
  });
});
