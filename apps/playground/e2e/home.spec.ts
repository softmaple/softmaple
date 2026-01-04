import { test, expect } from "@playwright/test";

test.describe("Home Page", () => {
  test("should load home page successfully", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check title
    await expect(page).toHaveTitle(/SoftMaple Playground/);

    // Check main heading
    await expect(
      page.getByRole("heading", { name: /SOFTMAPLE PLAYGROUND/i }),
    ).toBeVisible();
  });

  test("should display feature cards", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check for Two-Panel Editor Demo card - it's not a heading, it's a generic element
    await expect(page.getByText("Two-Panel Editor Demo")).toBeVisible();

   // Check for Collaborative Editor card - use exact match to avoid ambiguity with Online Collaborative Editor
   await expect(page.getByText("Collaborative Editor", { exact: true })).toBeVisible();
   
   // Check for Online Collaborative Editor card
   await expect(page.getByText("Online Collaborative Editor")).toBeVisible();
  });

  test("should navigate to two-panel editor", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Click on Two-Panel Editor Demo card - link contains full description
    await page.getByRole("link", { name: /Two-Panel Editor Demo/i }).click();

    // Verify navigation
    await expect(page).toHaveURL(/\/demo\/two-panel-editor/);
    await expect(
      page.getByRole("heading", { name: /Two-Panel Text Editor/i }),
    ).toBeVisible();
  });

  test("should navigate to collaborative editor", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Click on Collaborative Editor card - link contains full description
    await page
      .getByRole("link", {
        name: /Collaborative Editor.*Real-time collaborative/i,
      })
      .click();

    // Verify navigation
    await expect(page).toHaveURL(/\/demo\/collaborative-editor/);
    await expect(
      page.getByRole("heading", { name: /Collaborative Text Editor/i }),
    ).toBeVisible();
  });

  test("should navigate to online collaborative editor", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Click on Online Collaborative Editor card
    await page
      .getByRole("link", {
        name: /Online Collaborative Editor/i,
      })
      .click();

    // Verify navigation
    await expect(page).toHaveURL(/\/demo\/online-collab-editor/);
    await expect(
      page.getByRole("heading", { name: /Online Collaborative Editor/i }),
    ).toBeVisible();
  });
});
