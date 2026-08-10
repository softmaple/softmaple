import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { cleanupSeed, createSeed, login, type E2ESeed } from "./helpers/seed";

const runId = `pw-settings-${randomBytes(8).toString("hex")}`;
let seed: E2ESeed;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  seed = await createSeed(runId);
});

test.afterAll(async () => {
  await cleanupSeed(runId);
});

test("authenticated member can open Settings and Members from the workspace", async ({
  page,
}) => {
  await login(page, seed.owner);
  await page.goto(
    `/workspace/${seed.workspace.slug}/doc/${seed.document.slug}`,
  );
  await expect(page.getByLabel("Document title")).toBeVisible();

  const settingsLink = page.getByRole("link", { name: "Settings" }).first();
  await expect(settingsLink).toHaveAttribute(
    "href",
    `/workspace/${seed.workspace.slug}/settings`,
  );

  await settingsLink.click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === `/workspace/${seed.workspace.slug}/settings` &&
      url.search === "",
  );
  await expect(page.getByLabel("Name")).toHaveValue(seed.workspace.title);

  await page.getByRole("link", { name: "Members" }).first().click();
  await expect(page).toHaveURL(/tab=members/);
  await expect(page.getByText("E2E Editor")).toBeVisible();
});

test("unauthenticated Settings access redirects to login instead of 404", async ({
  page,
}) => {
  await page.goto(`/workspace/${seed.workspace.slug}/settings`);
  await expect(page).toHaveURL(/\/login/);
  const loginUrl = new URL(page.url());
  expect(loginUrl.pathname).toBe("/login");
  expect(loginUrl.searchParams.get("next")).toBe(
    `/workspace/${seed.workspace.slug}/settings`,
  );
  await expect(
    page.getByRole("heading", { name: /Welcome back/i }),
  ).toBeVisible();
  await expect(page.getByText(/This page could not be found/i)).toHaveCount(0);
});

test("missing workspace Settings slug returns 404", async ({ page }) => {
  await login(page, seed.owner);
  const response = await page.goto(
    "/workspace/does-not-exist-zzzzzzzzzzzz/settings",
  );
  expect(response?.status()).toBe(404);
  await expect(page.getByText(/This page could not be found/i)).toBeVisible();
});

test("authenticated viewer gets 404 for a missing workspace Settings slug", async ({
  page,
}) => {
  await login(page, seed.viewer);
  const response = await page.goto(
    "/workspace/does-not-exist-zzzzzzzzzzzz/settings",
  );
  expect(response?.status()).toBe(404);
  await expect(page.getByText(/This page could not be found/i)).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
});

test("non-member viewer gets 404 for an owner-only workspace Settings route", async ({
  page,
}) => {
  // RLS hides inaccessible workspaces as missing → ActionResult NOT_FOUND → notFound().
  await login(page, seed.viewer);
  const response = await page.goto(
    `/workspace/${seed.ownerOnlyWorkspace.slug}/settings`,
  );
  expect(response?.status()).toBe(404);
  await expect(page.getByText(/This page could not be found/i)).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
});
