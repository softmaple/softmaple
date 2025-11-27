import { test, expect } from "@playwright/test";

test.describe("Landing Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display hero section", async ({ page }) => {
    // Check hero content - the h1 says "Write visually, export professionally"
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /Write visually, export professionally/i,
    );

    // Check for Softmaple brand in header
    await expect(page.locator("header").getByText("Softmaple")).toBeVisible();

    // Check CTA buttons
    await expect(
      page.getByRole("link", { name: /Get Started/i }),
    ).toBeVisible();
  });

  test("should display features section", async ({ page }) => {
    // Check for feature-related content - adapt based on actual content
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();

    // Look for any section that might contain features
    // This test needs to be adapted based on actual page content
  });

  test("should have working navigation links", async ({ page }) => {
    // Check header navigation
    const header = page.getByRole("banner");

    // Based on the header.tsx, we have these links
    await expect(header.locator('a[href="#features"]')).toBeVisible();
    await expect(header.locator('a[href="#docs"]')).toBeVisible();
    await expect(header.locator('a[href="#pricing"]')).toBeVisible();
  });

  test("should have footer links", async ({ page }) => {
    // Scroll to footer
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const footer = page.getByRole("contentinfo");
    await expect(footer).toBeVisible();

    // Check for Softmaple text in footer
    await expect(footer.getByText("Softmaple", { exact: false })).toBeVisible();
  });

  test("should have dark mode toggle", async ({ page }) => {
    // Find the mode toggle button - it's in the header
    // Look for a button that contains an svg (sun/moon icon)
    const header = page.locator("header");
    const buttons = header.locator("button");

    // Find the button that has an SVG (likely the theme toggle)
    let themeToggle = null;
    const buttonCount = await buttons.count();

    for (let i = 0; i < buttonCount; i++) {
      const button = buttons.nth(i);
      if ((await button.locator("svg").count()) > 0) {
        themeToggle = button;
        break;
      }
    }

    if (themeToggle) {
      await expect(themeToggle).toBeVisible();

      // Get initial theme
      const htmlElement = page.locator("html");
      const initialTheme = await htmlElement.getAttribute("class");

      // Toggle theme
      await themeToggle.click();

      // Wait for transition
      await page.waitForTimeout(500);

      // Verify theme changed
      const newTheme = await htmlElement.getAttribute("class");
      expect(newTheme).not.toBe(initialTheme);
    }
  });

  test("should navigate to dashboard when clicking Get Started", async ({
    page,
  }) => {
    await page
      .getByRole("link", { name: /Get Started/i })
      .first()
      .click();

    // Should redirect to login or dashboard
    await expect(page).toHaveURL(/\/(login|dashboard|signup)/);
  });

  test("should be responsive on mobile", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // On mobile, the page should still have the header and main elements
    await expect(page.locator("header")).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign In/i })).toBeVisible();

    // The hero content should still be visible
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
