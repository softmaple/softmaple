import { test, expect, Page, Browser } from "@playwright/test";
import { mockAuthentication } from "./helpers/auth";

test.describe("Real-time Collaboration", () => {
  test("should show active users in document", async ({ browser }) => {
    // Create two browser contexts for two users
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Mock authentication for both users
    await mockAuthentication(page1, {
      userId: "user1",
      email: "user1@example.com",
    });
    await mockAuthentication(page2, {
      userId: "user2",
      email: "user2@example.com",
    });

    // Both users open the same document
    const docUrl = "/workspace/test-workspace/doc/shared-doc";
    await page1.goto(docUrl);
    await page2.goto(docUrl);

    // Check for presence indicators
    await expect(page1.getByText(/user2@example.com/i)).toBeVisible({
      timeout: 10000,
    });
    await expect(page2.getByText(/user1@example.com/i)).toBeVisible({
      timeout: 10000,
    });

    // Clean up
    await context1.close();
    await context2.close();
  });

  test("should sync text changes in real-time", async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await mockAuthentication(page1, {
      userId: "user1",
      email: "user1@example.com",
    });
    await mockAuthentication(page2, {
      userId: "user2",
      email: "user2@example.com",
    });

    const docUrl = "/workspace/test-workspace/doc/shared-doc";
    await page1.goto(docUrl);
    await page2.goto(docUrl);

    // User 1 types
    const editor1 = page1.getByRole("textbox", { name: /editor/i });
    await editor1.click();
    await page1.keyboard.type("Hello from User 1");

    // User 2 should see the changes
    const editor2 = page2.getByRole("textbox", { name: /editor/i });
    await expect(editor2).toContainText("Hello from User 1", { timeout: 5000 });

    // User 2 types
    await editor2.click();
    await page2.keyboard.press("End");
    await page2.keyboard.type(" and User 2");

    // User 1 should see the changes
    await expect(editor1).toContainText("Hello from User 1 and User 2", {
      timeout: 5000,
    });

    await context1.close();
    await context2.close();
  });

  test("should show cursor positions of other users", async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await mockAuthentication(page1, {
      userId: "user1",
      email: "user1@example.com",
    });
    await mockAuthentication(page2, {
      userId: "user2",
      email: "user2@example.com",
    });

    const docUrl = "/workspace/test-workspace/doc/shared-doc";
    await page1.goto(docUrl);
    await page2.goto(docUrl);

    // User 1 clicks in editor
    const editor1 = page1.getByRole("textbox", { name: /editor/i });
    await editor1.click();

    // User 2 should see User 1's cursor
    await expect(page2.locator('[data-cursor-user="user1"]')).toBeVisible({
      timeout: 5000,
    });

    // User 2 clicks in editor
    const editor2 = page2.getByRole("textbox", { name: /editor/i });
    await editor2.click();

    // User 1 should see User 2's cursor
    await expect(page1.locator('[data-cursor-user="user2"]')).toBeVisible({
      timeout: 5000,
    });

    await context1.close();
    await context2.close();
  });

  test.skip("should handle conflict resolution", async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await mockAuthentication(page1, {
      userId: "user1",
      email: "user1@example.com",
    });
    await mockAuthentication(page2, {
      userId: "user2",
      email: "user2@example.com",
    });

    // Go offline for User 2
    await page2.context().setOffline(true);

    const docUrl = "/workspace/test-workspace/doc/shared-doc";
    await page1.goto(docUrl);
    await page2.goto(docUrl);

    // Both users type while User 2 is offline
    const editor1 = page1.getByRole("textbox", { name: /editor/i });
    await editor1.click();
    await page1.keyboard.type("Online edit");

    const editor2 = page2.getByRole("textbox", { name: /editor/i });
    await editor2.click();
    await page2.keyboard.type("Offline edit");

    // User 2 goes back online
    await page2.context().setOffline(false);

    // Wait for sync
    await page2.waitForTimeout(2000);

    // Both users should have the same content after conflict resolution
    const content1 = await editor1.textContent();
    const content2 = await editor2.textContent();
    expect(content1).toBe(content2);

    await context1.close();
    await context2.close();
  });

  test.skip("should show typing indicators", async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await mockAuthentication(page1, {
      userId: "user1",
      email: "user1@example.com",
    });
    await mockAuthentication(page2, {
      userId: "user2",
      email: "user2@example.com",
    });

    const docUrl = "/workspace/test-workspace/doc/shared-doc";
    await page1.goto(docUrl);
    await page2.goto(docUrl);

    // User 1 starts typing
    const editor1 = page1.getByRole("textbox", { name: /editor/i });
    await editor1.click();
    await page1.keyboard.type("Typing...");

    // User 2 should see typing indicator
    await expect(page2.getByText(/user1@example.com is typing/i)).toBeVisible({
      timeout: 5000,
    });

    // User 1 stops typing
    await page1.waitForTimeout(3000);

    // Typing indicator should disappear
    await expect(
      page2.getByText(/user1@example.com is typing/i),
    ).not.toBeVisible();

    await context1.close();
    await context2.close();
  });
});

test.describe("Comments and Mentions", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthentication(page, {
      userId: "user1",
      email: "user1@example.com",
    });
  });

  test.skip("should add a comment to document", async ({ page }) => {
    await page.goto("/workspace/test-workspace/doc/test-doc");

    // Select some text
    const editor = page.getByRole("textbox", { name: /editor/i });
    await editor.click();
    await page.keyboard.type("This is commentable text");
    await page.keyboard.press("Control+A");

    // Add comment
    await page.getByRole("button", { name: /Add comment/i }).click();

    // Type comment
    const commentBox = page.getByPlaceholder(/Add a comment/i);
    await commentBox.fill("This needs review");
    await page.keyboard.press("Enter");

    // Verify comment appears
    await expect(page.getByText("This needs review")).toBeVisible();
  });

  test.skip("should mention users in comments", async ({ page }) => {
    await page.goto("/workspace/test-workspace/doc/test-doc");

    // Open comment panel
    await page.getByRole("button", { name: /Comments/i }).click();

    // Start typing a mention
    const commentBox = page.getByPlaceholder(/Add a comment/i);
    await commentBox.click();
    await commentBox.type("@user");

    // Mention dropdown should appear
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.getByRole("option", { name: /user2/i })).toBeVisible();

    // Select user from dropdown
    await page.getByRole("option", { name: /user2/i }).click();

    // Complete comment
    await commentBox.type(" please review this");
    await page.keyboard.press("Enter");

    // Verify mention in comment
    await expect(page.getByText("@user2 please review this")).toBeVisible();
  });

  test.skip("should resolve comments", async ({ page }) => {
    await page.goto("/workspace/test-workspace/doc/test-doc");

    // Assume there's an existing comment
    await page.getByRole("button", { name: /Comments/i }).click();

    // Find a comment and resolve it
    const comment = page.locator("[data-comment]").first();
    await comment.hover();
    await comment.getByRole("button", { name: /Resolve/i }).click();

    // Comment should be marked as resolved
    await expect(comment).toHaveAttribute("data-resolved", "true");
    await expect(page.getByText(/Resolved/i)).toBeVisible();
  });
});
