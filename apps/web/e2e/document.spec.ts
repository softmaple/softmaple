import { test, expect, Page } from "@playwright/test";
import { mockAuthentication } from "./helpers/auth";
import { mockAllServices } from "./helpers/mock-services";

test.describe.skip("Document Management", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllServices(page);
    await mockAuthentication(page);
  });

  test("should create a new document", async ({ page }) => {
    await page.goto("/workspace/test-workspace");

    // Click create document
    await page.getByRole("button", { name: /Create Document/i }).click();

    // Fill in document details
    await page.getByLabel(/Document Title/i).fill("Test Document");
    await page.getByLabel(/Description/i).fill("This is a test document");

    // Submit
    await page.getByRole("button", { name: /Create/i }).click();

    // Verify document was created
    await expect(page).toHaveURL(/\/workspace\/test-workspace\/doc\/.+/);
    await expect(
      page.getByRole("heading", { name: "Test Document" }),
    ).toBeVisible();
  });

  test("should open document editor", async ({ page }) => {
    await page.goto("/workspace/test-workspace/doc/test-doc-id");

    // Check editor is loaded
    await expect(page.getByRole("textbox", { name: /editor/i })).toBeVisible();
    await expect(page.getByRole("toolbar")).toBeVisible();
  });

  test("should save document changes", async ({ page }) => {
    await page.goto("/workspace/test-workspace/doc/test-doc-id");

    // Wait for editor
    const editor = page.getByRole("textbox", { name: /editor/i });
    await expect(editor).toBeVisible();

    // Type in editor
    await editor.click();
    await page.keyboard.type("This is my document content");

    // Check for auto-save indicator or save button
    await expect(
      page.getByText(/Saved/i).or(page.getByText(/Saving/i)),
    ).toBeVisible({ timeout: 5000 });
  });

  test("should format text in editor", async ({ page }) => {
    await page.goto("/workspace/test-workspace/doc/test-doc-id");

    const editor = page.getByRole("textbox", { name: /editor/i });
    await editor.click();

    // Type and select text
    await page.keyboard.type("Bold text");
    await page.keyboard.press("Control+A");

    // Apply bold formatting
    await page.getByRole("button", { name: /Bold/i }).click();

    // Verify formatting applied
    await expect(editor.locator("strong")).toContainText("Bold text");
  });

  test("should insert lists", async ({ page }) => {
    await page.goto("/workspace/test-workspace/doc/test-doc-id");

    const editor = page.getByRole("textbox", { name: /editor/i });
    await editor.click();

    // Click bullet list button
    await page.getByRole("button", { name: /Bullet List/i }).click();

    // Type list items
    await page.keyboard.type("First item");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second item");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Third item");

    // Verify list structure
    await expect(editor.locator("ul li")).toHaveCount(3);
  });

  test("should insert headings", async ({ page }) => {
    await page.goto("/workspace/test-workspace/doc/test-doc-id");

    const editor = page.getByRole("textbox", { name: /editor/i });
    await editor.click();

    // Apply heading format
    await page.getByRole("button", { name: /Heading/i }).click();
    await page.keyboard.type("Main Heading");

    // Verify heading
    await expect(editor.locator("h1, h2, h3")).toContainText("Main Heading");
  });

  test("should delete a document", async ({ page }) => {
    await page.goto("/workspace/test-workspace");

    // Find a document card
    const documentCard = page.getByRole("article").first();
    await documentCard.hover();

    // Click more options
    await documentCard.getByRole("button", { name: /More options/i }).click();

    // Click delete
    await page.getByRole("menuitem", { name: /Delete/i }).click();

    // Confirm deletion
    await page.getByRole("button", { name: /Confirm/i }).click();

    // Verify document is removed
    await expect(page.getByText(/Document deleted/i)).toBeVisible();
  });

  test("should rename a document", async ({ page }) => {
    await page.goto("/workspace/test-workspace/doc/test-doc-id");

    // Click on document title to edit
    const title = page.getByRole("heading", { level: 1 });
    await title.click();

    // Clear and type new name
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Renamed Document");
    await page.keyboard.press("Enter");

    // Verify rename
    await expect(
      page.getByRole("heading", { name: "Renamed Document" }),
    ).toBeVisible();
  });

  test("should export document", async ({ page }) => {
    await page.goto("/workspace/test-workspace/doc/test-doc-id");

    // Open export menu
    await page.getByRole("button", { name: /Export/i }).click();

    // Check export options
    await expect(page.getByRole("menuitem", { name: /PDF/i })).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /Markdown/i }),
    ).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /HTML/i })).toBeVisible();
  });

  test("should show document history", async ({ page }) => {
    await page.goto("/workspace/test-workspace/doc/test-doc-id");

    // Open history panel
    await page.getByRole("button", { name: /History/i }).click();

    // Check history entries
    await expect(page.getByText(/Version History/i)).toBeVisible();
    await expect(page.getByText(/Last edited/i)).toBeVisible();
  });
});
