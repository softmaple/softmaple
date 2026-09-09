import { randomBytes } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cleanupSeed, createSeed, login, type E2ESeed } from "./helpers/seed";

const runId = `pw-${randomBytes(8).toString("hex")}`;
let seed: E2ESeed;

const documentUrl = () =>
  `/workspace/${seed.workspace.slug}/doc/${seed.document.slug}`;

const openAs = async (
  context: BrowserContext,
  credentials: E2ESeed["owner"] | E2ESeed["editor"] | E2ESeed["viewer"],
): Promise<Page> => {
  const page = await context.newPage();
  await login(page, credentials);
  await page.goto(documentUrl());
  return page;
};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  seed = await createSeed(runId);
});

test.afterAll(async () => {
  await cleanupSeed(runId);
});

test("owner sees real workspace counts and stable settings", async ({
  page,
}) => {
  await login(page, seed.owner);
  await expect(page.getByText(seed.workspace.title)).toBeVisible();
  await page.goto(`/workspace/${seed.workspace.slug}`);
  await expect(page.getByText("Shared notes")).toBeVisible();
  await page.goto(`/workspace/${seed.workspace.slug}/settings`);
  await expect(page.getByLabel("Name")).toHaveValue(seed.workspace.title);
  await page.getByRole("tab", { name: /Members/ }).click();
  await expect(page.getByText("E2E Editor")).toBeVisible();
  await expect(page.getByText("E2E Viewer")).toBeVisible();
});

test("workspace metadata and deletion are durable", async ({ page }) => {
  await login(page, seed.owner);
  await page.getByRole("button", { name: "New workspace" }).click();
  await page.getByLabel("Workspace name").fill("Disposable E2E Space");
  await page.getByLabel("Description (optional)").fill("Created by Playwright");
  await page.getByRole("button", { name: "Create Workspace" }).click();
  await page.waitForURL(/\/workspace\/[^/?]+$/);
  await page
    .getByRole("link", { name: /Settings/ })
    .first()
    .click();
  await page.getByLabel("Name").fill("Renamed E2E Space");
  await page.getByRole("button", { name: "Save workspace" }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved");
  await page.getByRole("tab", { name: "Danger zone" }).click();
  await page
    .getByLabel("Workspace deletion confirmation")
    .fill("Renamed E2E Space");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete workspace" }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByText("Renamed E2E Space")).toHaveCount(0);
});

test("owner can change a member role and restore it", async ({ page }) => {
  await login(page, seed.owner);
  await page.goto(`/workspace/${seed.workspace.slug}/settings?tab=members`);
  const role = page.getByLabel("Role for E2E Viewer");
  await expect(role).toHaveValue("VIEWER");
  await role.selectOption("EDITOR");
  await expect(page.getByRole("status")).toContainText("Changes saved");
  await expect(role).toHaveValue("EDITOR");
  await role.selectOption("VIEWER");
  await expect(role).toHaveValue("VIEWER");
});

test("member roles enforce document capabilities", async ({ page }) => {
  await login(page, seed.viewer);
  await page.goto(documentUrl());
  await expect(page.getByLabel("Document title")).toBeDisabled();
  await expect(page.locator('[contenteditable="false"]').first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete document" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Download Markdown" }),
  ).toBeVisible();
  await page.goto(`/workspace/${seed.workspace.slug}`);
  await expect(page.getByRole("link", { name: "New document" })).toHaveCount(0);

  await page.goto(`/workspace/${seed.workspace.slug}/settings?tab=members`);
  await expect(page.getByText(seed.viewer.email)).toHaveCount(0);
});

test("new document mounts the editor only after metadata creation", async ({
  page,
}) => {
  await login(page, seed.owner);
  await page.goto(`/workspace/${seed.workspace.slug}/doc/new`);
  await page.getByLabel("Document title").fill("First durable line");
  await page.getByRole("button", { name: /Create and edit/i }).click();
  await page.waitForURL(/\/doc\/(?!new)[^/?]+$/);
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.fill("The opening paragraph survives refresh.");
  await expect(page.getByRole("status")).toContainText("Saved", {
    timeout: 20_000,
  });
  await page.reload();
  await expect(page.locator('[contenteditable="true"]').first()).toContainText(
    "The opening paragraph survives refresh.",
  );
});

test("two authenticated clients converge and show aggregated presence", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await openAs(ownerContext, seed.owner);
  // Collaboration WebSockets are only enabled after a document is shared.
  await ownerPage.getByRole("button", { name: "Share" }).click();
  await expect(
    ownerPage.getByText(
      "Public read-only link enabled. Workspace members can now collaborate live.",
    ),
  ).toBeVisible();

  const editorContext = await browser.newContext();
  const editorPage = await openAs(editorContext, seed.editor);
  await expect(
    ownerPage.getByRole("button", {
      name: "2 people here. Show collaborators",
    }),
  ).toBeVisible({
    timeout: 15_000,
  });
  const ownerEditor = ownerPage.locator('[contenteditable="true"]').first();
  await ownerEditor.fill("Concurrent field observation");
  await expect(
    editorPage.locator('[contenteditable="true"]').first(),
  ).toContainText("Concurrent field observation", { timeout: 15_000 });
  await ownerContext.close();
  await editorContext.close();
});

test("preview, export, public sharing, and revocation use live content", async ({
  page,
}) => {
  await login(page, seed.owner);
  await page.goto(documentUrl());
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.fill("# Public observation");
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(
    page.getByRole("heading", { name: "Public observation" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Markdown/i }).click();
  await expect((await download).suggestedFilename()).toMatch(/\.md$/);
  // This serial fixture was shared in the prior collaboration scenario.
  if (
    await page
      .getByRole("button", { name: "Disable link", exact: true })
      .count()
  ) {
    await page
      .getByRole("button", { name: "Disable link", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Share", exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Share" }).click();
  await expect(
    page.getByText(
      "Public read-only link enabled. Workspace members can now collaborate live.",
    ),
  ).toBeVisible();

  const anonymous = await page.context().browser()?.newContext();
  if (anonymous === undefined) throw new Error("Browser context unavailable");
  const shared = await anonymous.newPage();
  await shared.goto(`/share/${seed.document.slug}`);
  await expect(shared.getByText("Shared read-only document")).toBeVisible();
  await expect(
    shared.locator('[contenteditable="false"]').first(),
  ).toContainText("Public observation");
  await page.getByRole("button", { name: "Disable link" }).click();
  await expect(
    page.getByRole("button", { name: "Share", exact: true }),
  ).toBeVisible();
  await shared.reload();
  await expect(shared.getByText(/could not be found|not found/i)).toBeVisible();
  await anonymous.close();
});

test("account profile supports theme, avatar entry, and password reset", async ({
  page,
}) => {
  await login(page, seed.owner);
  await page.goto("/settings/account");
  await expect(page.getByLabel("Email")).toHaveValue(seed.owner.email);
  const themeToggle = page
    .getByRole("button", { name: "Toggle theme" })
    .first();
  await expect(themeToggle).toHaveAttribute("aria-haspopup", "menu");
  await themeToggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Light" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByLabel("Upload image").setInputFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "avatar.png",
  });
  await expect(page.getByRole("status")).toContainText("Avatar updated");
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("status")).toContainText("Avatar removed");
  await expect(
    page.getByRole("link", { name: /Reset password/i }),
  ).toHaveAttribute("href", "/reset-password");
});
