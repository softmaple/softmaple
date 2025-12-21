import { test, expect } from "@playwright/test";

test.describe("Collaborative Text Editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/collaborative-editor");
    // Wait for page to be fully loaded
    await page.waitForLoadState("networkidle");
  });

  test("should display two replica editors", async ({ page }) => {
    // Check for Replica 1
    await expect(
      page.getByRole("heading", { name: /Replica 1/i }),
    ).toBeVisible();

    // Check for Replica 2
    await expect(
      page.getByRole("heading", { name: /Replica 2/i }),
    ).toBeVisible();

    // Check for textareas
    const textareas = page.getByRole("textbox");
    await expect(textareas).toHaveCount(2);
  });

  test("should sync insertions from Replica 1 to Replica 2", async ({
    page,
  }) => {
    const textareas = page.getByRole("textbox");
    const replica1 = textareas.first();
    const replica2 = textareas.last();

    // Type in Replica 1
    await replica1.fill("Hello");
    // Give the CRDT event processing time to propagate
    await page.waitForTimeout(500);

    // Wait for sync and check Replica 2
    await expect(replica2).toHaveValue("Hello", { timeout: 5000 });
  });

  test("should sync insertions from Replica 2 to Replica 1", async ({
    page,
  }) => {
    const textareas = page.getByRole("textbox");
    const replica1 = textareas.first();
    const replica2 = textareas.last();

    // Type in Replica 2
    await replica2.fill("World");
    // Give the CRDT event processing time to propagate
    await page.waitForTimeout(500);

    // Wait for sync and check Replica 1
    await expect(replica1).toHaveValue("World", { timeout: 5000 });
  });

  test("should sync deletions between replicas", async ({ page }) => {
    const textareas = page.getByRole("textbox");
    const replica1 = textareas.first();
    const replica2 = textareas.last();

    // Type in Replica 1
    await replica1.fill("Hello World");
    await page.waitForTimeout(500);
    await expect(replica2).toHaveValue("Hello World", { timeout: 5000 });

    // Delete some text in Replica 1
    await replica1.fill("Hello");
    await page.waitForTimeout(500);
    await expect(replica2).toHaveValue("Hello", { timeout: 5000 });
  });

  test("should sync text replacements between replicas", async ({ page }) => {
    const textareas = page.getByRole("textbox");
    const replica1 = textareas.first();
    const replica2 = textareas.last();

    // Initial text
    await replica1.fill("hello");
    await page.waitForTimeout(500);
    await expect(replica2).toHaveValue("hello", { timeout: 5000 });

    // Replace with same-length text
    await replica1.fill("HELLO");
    await page.waitForTimeout(500);
    await expect(replica2).toHaveValue("HELLO", { timeout: 5000 });
  });

  test("should handle multi-line text synchronization", async ({ page }) => {
    const textareas = page.getByRole("textbox");
    const replica1 = textareas.first();
    const replica2 = textareas.last();

    const multiLineText = "Line 1\nLine 2\nLine 3";
    await replica1.fill(multiLineText);
    await page.waitForTimeout(500);

    // Wait for sync
    await expect(replica2).toHaveValue(multiLineText, { timeout: 5000 });
  });

  test("should handle rapid typing", async ({ page }) => {
    const textareas = page.getByRole("textbox");
    const replica1 = textareas.first();
    const replica2 = textareas.last();

    // Type rapidly in Replica 1
    await replica1.type("Quick brown fox", { delay: 50 });
    await page.waitForTimeout(1000);

    // Wait for final sync
    await expect(replica2).toHaveValue("Quick brown fox", { timeout: 10000 });
  });

  test("should display CRDT algorithm info", async ({ page }) => {
    // Check for algorithm description
    await expect(page.getByText(/Eg-Walker CRDT Algorithm/i)).toBeVisible();
  });

  test("should have accessible labels", async ({ page }) => {
    // Check that textareas have proper aria-labelledby attributes
    const replica1 = page.locator('[aria-labelledby="replica-1-label"]');
    const replica2 = page.locator('[aria-labelledby="replica-2-label"]');

    await expect(replica1).toBeVisible();
    await expect(replica2).toBeVisible();
  });
});
