import { expect, test } from "@playwright/test";

test.describe("Two-Panel Text Editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/two-panel-editor");
    await page.waitForLoadState("networkidle");
  });

  test("should display two editor panels", async ({ page }) => {
    // Check for Editor A - CardTitle renders as div, not heading
    await expect(page.getByText("Editor A", { exact: true })).toBeVisible();

    // Check for Editor B - CardTitle renders as div, not heading
    await expect(page.getByText("Editor B", { exact: true })).toBeVisible();

    // Check for textareas
    const textareas = page.getByRole("textbox");
    await expect(textareas).toHaveCount(2);
  });

  test("should allow typing in Editor A", async ({ page }) => {
    // The textbox has aria-label="Editor A", not aria-labelledby
    const editorA = page.getByRole("textbox", { name: "Editor A" });

    await editorA.fill("Hello from Editor A");
    await expect(editorA).toHaveValue("Hello from Editor A");
  });

  test("should allow typing in Editor B", async ({ page }) => {
    // The textbox has aria-label="Editor B", not aria-labelledby
    const editorB = page.getByRole("textbox", { name: "Editor B" });

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
    // Check that textareas have proper aria-label attributes
    const editorA = page.getByRole("textbox", { name: "Editor A" });
    const editorB = page.getByRole("textbox", { name: "Editor B" });

    await expect(editorA).toBeVisible();
    await expect(editorB).toBeVisible();
  });
});
