import { test, expect } from "@playwright/test";

test.describe("Collaborative Text Editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/collaborative-editor");
    // Wait for DOM to load and editors to be rendered
    await page.waitForLoadState("domcontentloaded");
    // Wait for both textareas to be ready
    await page.locator('textarea[data-testid="replica-1"]').waitFor();
    await page.locator('textarea[data-testid="replica-2"]').waitFor();
  });

  test("should display two replica editors", async ({ page }) => {
    // Check for Replica 1 - CardTitle renders as div, not heading
    await expect(page.getByText("Replica 1")).toBeVisible();

    // Check for Replica 2
    await expect(page.getByText("Replica 2")).toBeVisible();

    // Check for textareas
    const textareas = page.getByRole("textbox");
    await expect(textareas).toHaveCount(2);
  });

  test("should sync insertions from Replica 1 to Replica 2", async ({
    page,
  }) => {
    const replica1 = page.locator('textarea[data-testid="replica-1"]');
    const replica2 = page.locator('textarea[data-testid="replica-2"]');

    // Type in Replica 1 using pressSequentially to trigger change events
    await replica1.click();
    await replica1.pressSequentially("Hello", { delay: 100 });

    // Wait for sync to replica2 (CRDT propagation)
    await expect(replica2).toHaveValue("Hello", { timeout: 5000 });
  });

  test("should sync insertions from Replica 2 to Replica 1", async ({
    page,
  }) => {
    const replica1 = page.locator('textarea[data-testid="replica-1"]');
    const replica2 = page.locator('textarea[data-testid="replica-2"]');

    // Type in Replica 2 using pressSequentially
    await replica2.click();
    await replica2.pressSequentially("World", { delay: 100 });

    // Wait for sync to replica1
    await expect(replica1).toHaveValue("World", { timeout: 5000 });
  });

  test("should sync deletions between replicas", async ({ page }) => {
    const replica1 = page.locator('textarea[data-testid="replica-1"]');
    const replica2 = page.locator('textarea[data-testid="replica-2"]');

    // Type initial text
    await replica1.click();
    await replica1.pressSequentially("Hello World", { delay: 100 });
    await expect(replica2).toHaveValue("Hello World", { timeout: 5000 });

    // Delete " World" by selecting it and pressing backspace
    await replica1.press("End");
    for (let i = 0; i < 6; i++) {
      await replica1.press("Backspace");
      await page.waitForTimeout(50);
    }

    await expect(replica2).toHaveValue("Hello", { timeout: 5000 });
  });

  test("should sync text replacements between replicas", async ({ page }) => {
    const replica1 = page.locator('textarea[data-testid="replica-1"]');
    const replica2 = page.locator('textarea[data-testid="replica-2"]');

    // Initial text
    await replica1.click();
    await replica1.pressSequentially("hello", { delay: 100 });
    await expect(replica2).toHaveValue("hello", { timeout: 5000 });

    // Replace by selecting all and typing new text
    await replica1.press("Control+A");
    await replica1.pressSequentially("HELLO", { delay: 100 });
    await expect(replica2).toHaveValue("HELLO", { timeout: 5000 });
  });

  test("should handle multi-line text synchronization", async ({ page }) => {
    const replica1 = page.locator('textarea[data-testid="replica-1"]');
    const replica2 = page.locator('textarea[data-testid="replica-2"]');

    const multiLineText = "Line 1\nLine 2\nLine 3";
    await replica1.click();
    await replica1.pressSequentially(multiLineText, { delay: 100 });

    await expect(replica2).toHaveValue(multiLineText, { timeout: 5000 });
  });

  test("should handle rapid typing", async ({ page }) => {
    const replica1 = page.locator('textarea[data-testid="replica-1"]');
    const replica2 = page.locator('textarea[data-testid="replica-2"]');

    // Type rapidly in Replica 1 with shorter delay
    await replica1.click();
    await replica1.pressSequentially("Quick brown fox", { delay: 50 });

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
