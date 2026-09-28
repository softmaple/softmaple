import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { cleanupSeed, createRecovery, login } from "./helpers/seed";

const runId = `pw-reset-${randomBytes(8).toString("hex")}`;

test.afterAll(async () => {
  await cleanupSeed(runId);
});

test("a reset link works in a fresh browser, once", async ({ page }) => {
  const recovery = await createRecovery(runId);
  // What the Reset Password email template links to (docs/development.mdx).
  // This browser never requested the link, so no PKCE cookie can help it.
  const link = `/auth/confirm?token_hash=${encodeURIComponent(recovery.tokenHash)}&type=recovery&next=/reset-password/update`;
  const newPassword = `Reset-${randomBytes(9).toString("base64url")}7a`;
  const invalidLink =
    "This reset link has expired or was already used. Request a new one.";

  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password\/update$/);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(newPassword);
  await page
    .getByRole("button", { name: "Update password", exact: true })
    .click();
  await page.waitForURL(/\/login\?message=/);
  await expect(
    page.getByText("Password updated. Log in with your new password.", {
      exact: true,
    }),
  ).toBeVisible();

  // Signed out, a used link offers a new one.
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password\?error=reset_link_invalid$/);
  await expect(page.getByText(invalidLink, { exact: true })).toBeVisible();

  await login(page, { email: recovery.email, password: newPassword });

  // Signed in, it lands beside the account page's reset button instead.
  await page.goto(link);
  await expect(page).toHaveURL(
    /\/settings\/account\?error=reset_link_invalid$/,
  );
  await expect(page.getByText(invalidLink, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send reset link", exact: true }),
  ).toBeEnabled();
});
