import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const typeInto = async (
  page: Page,
  locator: Locator,
  text: string,
  delay = 80,
) => {
  await locator.click();
  await page.keyboard.type(text, { delay });
};

test.describe("Collaborative Text Editor", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/collaborative-editor");
    await page.waitForLoadState("domcontentloaded");
    await page.locator('textarea[data-testid="replica-1"]').waitFor();
    await page.locator('textarea[data-testid="replica-2"]').waitFor();
    await page.locator('[data-bindings-ready="true"]').waitFor();
  });

  test("should display two replica editors", async ({ page }) => {
    await expect(page.getByText("Replica 1")).toBeVisible();
    await expect(page.getByText("Replica 2")).toBeVisible();
    const textareas = page.getByRole("textbox");
    await expect(textareas).toHaveCount(2);
  });

  test("should sync insertions from Replica 1 to Replica 2", async ({
    page,
  }) => {
    const replica1 = page.locator('textarea[data-testid="replica-1"]');
    const replica2 = page.locator('textarea[data-testid="replica-2"]');

    await typeInto(page, replica1, "Hello");
    await expect(replica1).toHaveValue("Hello");
    await expect(replica2).toHaveValue("Hello", { timeout: 5000 });
  });

  test("should sync insertions from Replica 2 to Replica 1", async ({
    page,
  }) => {
    const replica1 = page.locator('textarea[data-testid="replica-1"]');
    const replica2 = page.locator('textarea[data-testid="replica-2"]');

    await typeInto(page, replica2, "World");
    await expect(replica2).toHaveValue("World");
    await expect(replica1).toHaveValue("World", { timeout: 5000 });
  });

  test("should sync deletions between replicas", async ({ page }) => {
    const replica1 = page.locator('textarea[data-testid="replica-1"]');
    const replica2 = page.locator('textarea[data-testid="replica-2"]');

    await typeInto(page, replica1, "Hello World");
    await expect(replica2).toHaveValue("Hello World", { timeout: 5000 });

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

    await typeInto(page, replica1, "hello");
    await expect(replica2).toHaveValue("hello", { timeout: 5000 });

    await replica1.press("ControlOrMeta+A");
    // Do not click again — that would collapse the selection.
    await page.keyboard.type("HELLO", { delay: 80 });
    await expect(replica2).toHaveValue("HELLO", { timeout: 5000 });
  });

  test("should handle multi-line text synchronization", async ({ page }) => {
    const replica1 = page.locator('textarea[data-testid="replica-1"]');
    const replica2 = page.locator('textarea[data-testid="replica-2"]');

    const multiLineText = "Line 1\nLine 2\nLine 3";
    await typeInto(page, replica1, multiLineText);
    await expect(replica2).toHaveValue(multiLineText, { timeout: 5000 });
  });

  test("should handle rapid typing", async ({ page }) => {
    const replica1 = page.locator('textarea[data-testid="replica-1"]');
    const replica2 = page.locator('textarea[data-testid="replica-2"]');

    await typeInto(page, replica1, "Quick brown fox", 40);
    await expect(replica2).toHaveValue("Quick brown fox", { timeout: 10000 });
  });

  test("should display CRDT algorithm info", async ({ page }) => {
    await expect(page.getByText(/Eg-Walker CRDT Algorithm/i)).toBeVisible();
  });

  test("should have accessible labels", async ({ page }) => {
    const replica1 = page.locator('[aria-labelledby="replica-1-label"]');
    const replica2 = page.locator('[aria-labelledby="replica-2-label"]');

    await expect(replica1).toBeVisible();
    await expect(replica2).toBeVisible();
  });
});
