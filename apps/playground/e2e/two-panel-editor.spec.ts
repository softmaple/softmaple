import { test, expect } from "@playwright/test";

test.describe("Two-Panel Text Editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/two-panel-editor");
    await page.waitForLoadState("networkidle");
  });

  test("should display two editor panels", async ({ page }) => {
    // Check for Editor A
    await expect(
      page.getByRole("heading", { name: /Editor A/i }),
    ).toBeVisible();

    // Check for Editor B
    await expect(
      page.getByRole("heading", { name: /Editor B/i }),
    ).toBeVisible();

    // Check for textareas
    const textareas = page.getByRole("textbox");
    await expect(textareas).toHaveCount(2);
  });

  test("should allow typing in Editor A", async ({ page }) => {
    const editorA = page
      .getByRole("textbox")
      .filter({ has: page.locator('[aria-labelledby="editor-a-label"]') })
      .first();

    await editorA.fill("Hello from Editor A");
    await expect(editorA).toHaveValue("Hello from Editor A");
  });

  test("should allow typing in Editor B", async ({ page }) => {
    const editorB = page
      .getByRole("textbox")
      .filter({ has: page.locator('[aria-labelledby="editor-b-label"]') })
      .last();

    await editorB.fill("Hello from Editor B");
    await expect(editorB).toHaveValue("Hello from Editor B");
  });

  test("should maintain independent state between editors", async ({
    page,
  }) => {
    const textareas = page.getByRole("textbox");
    const editorA = textareas.first();
    const editorB = textareas.last();

    // Type in Editor A
    await editorA.fill("Text in A");
    await expect(editorA).toHaveValue("Text in A");
    await expect(editorB).toHaveValue("");

    // Type in Editor B
    await editorB.fill("Text in B");
    await expect(editorA).toHaveValue("Text in A");
    await expect(editorB).toHaveValue("Text in B");
  });

  test("should support multi-line text", async ({ page }) => {
    const editorA = page.getByRole("textbox").first();

    const multiLineText = "Line 1\nLine 2\nLine 3";
    await editorA.fill(multiLineText);
    await expect(editorA).toHaveValue(multiLineText);
  });

  test("should have accessible labels", async ({ page }) => {
    // Check that textareas have proper aria-labelledby attributes
    const editorA = page.locator('[aria-labelledby="editor-a-label"]');
    const editorB = page.locator('[aria-labelledby="editor-b-label"]');

    await expect(editorA).toBeVisible();
    await expect(editorB).toBeVisible();
  });
});
