import { expect, test } from "@playwright/test";

test.describe("Home Page", () => {
  test("should load home page successfully", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/SoftMaple Playground/);
    await expect(
      page.getByRole("heading", { name: /SOFTMAPLE PLAYGROUND/i }),
    ).toBeVisible();
  });

  test("should display SoftMaple demo cards", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Demos" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Lexical × EG-walker/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Online Collaborative Editor/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Awareness \+ Eg-Walker/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: /Collaborative Editor.*Side-by-side text editors/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Two-Panel Editor Demo/i }),
    ).toBeVisible();
  });

  test("should navigate to Lexical EG-walker demo", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: /Open Lexical demo/i }).click();
    await expect(page).toHaveURL(/\/demo\/lexical-eg-walker/);
  });

  test("should navigate to two-panel editor", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: /Two-Panel Editor Demo/i }).click();
    await expect(page).toHaveURL(/\/demo\/two-panel-editor/);
    await expect(
      page.getByRole("heading", { name: /Two-Panel Text Editor/i }),
    ).toBeVisible();
  });

  test("should navigate to collaborative editor", async ({ page }) => {
    await page.goto("/");

    await page
      .getByRole("link", {
        name: /Collaborative Editor.*Side-by-side text editors/i,
      })
      .click();

    await expect(page).toHaveURL(/\/demo\/collaborative-editor/);
    await expect(
      page.getByRole("heading", { name: /Collaborative Text Editor/i }),
    ).toBeVisible();
  });

  test("should navigate to online collaborative editor", async ({ page }) => {
    await page.goto("/");

    await page
      .getByRole("link", {
        name: /Online Collaborative Editor/i,
      })
      .click();

    await expect(page).toHaveURL(/\/demo\/online-collab-editor/);
    await expect(
      page.getByRole("heading", { name: /Online Collaborative Editor/i }),
    ).toBeVisible();
  });
});
