import { expect, test } from "@playwright/test";

test.describe("public product surface", () => {
  test("landing, auth navigation, and unavailable OAuth are truthful", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Softmaple/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Ideas move",
    );
    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "GitHub" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Google" })).toBeDisabled();
    await expect(
      page.getByText("GitHub and Google sign-in are coming soon."),
    ).toBeVisible();
  });

  test("email forms expose validation and recovery paths", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("First name").fill("Ada");
    await page.getByLabel("Last name").fill("Lovelace");
    await page.getByLabel("Email").fill("ada@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("different123");
    await page.getByRole("button", { name: /Create account/i }).click();
    await expect(page.getByText("Passwords do not match.")).toBeVisible();

    await page.goto("/login");
    await page.getByRole("link", { name: /Forgot password/i }).click();
    await expect(page).toHaveURL(/\/reset-password$/);
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("theme and 320px layout remain usable", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/");
    const initialOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(initialOverflow).toBeLessThanOrEqual(0);
    const themeToggle = page.getByRole("button", { name: "Toggle theme" });
    // Wait for the client dropdown trigger to hydrate, then open via keyboard
    // to avoid Radix pointerdown/mouseup dismiss races in headless CI.
    await expect(themeToggle).toHaveAttribute("aria-haspopup", "menu");
    await themeToggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Dark" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus-visible")).toBeVisible();
  });

  test("coming-soon redirects to signup", async ({ page }) => {
    await page.goto("/coming-soon");
    await expect(page).toHaveURL(/\/signup$/);
  });
});
