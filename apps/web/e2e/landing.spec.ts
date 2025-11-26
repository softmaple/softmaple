import { test, expect } from "@playwright/test";

test.describe("Landing Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display hero section", async ({ page }) => {
    // Check hero content
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /SoftMaple/i,
    );
    await expect(page.getByText(/collaborative/i)).toBeVisible();

    // Check CTA buttons
    await expect(
      page.getByRole("link", { name: /Get Started/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Learn More/i })).toBeVisible();
  });

  test("should display features section", async ({ page }) => {
    // Scroll to features if needed
    await page.getByText(/Features/i).scrollIntoViewIfNeeded();

    // Check for feature cards
    await expect(page.getByText(/Real-time Collaboration/i)).toBeVisible();
    await expect(page.getByText(/Rich Text Editor/i)).toBeVisible();
    await expect(page.getByText(/Workspace Management/i)).toBeVisible();
  });

  test("should have working navigation links", async ({ page }) => {
    // Check header navigation
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: /Home/i })).toBeVisible();
    await expect(header.getByRole("link", { name: /Features/i })).toBeVisible();
    await expect(header.getByRole("link", { name: /About/i })).toBeVisible();
    await expect(header.getByRole("link", { name: /Contact/i })).toBeVisible();
  });

  test("should have footer links", async ({ page }) => {
    // Scroll to footer
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const footer = page.getByRole("contentinfo");
    await expect(footer).toBeVisible();

    // Check social links
    await expect(footer.getByRole("link", { name: /GitHub/i })).toBeVisible();
    await expect(footer.getByRole("link", { name: /Twitter/i })).toBeVisible();
  });

  test("should have dark mode toggle", async ({ page }) => {
    // Find and click theme toggle
    const themeToggle = page.getByRole("button", { name: /toggle theme/i });
    await expect(themeToggle).toBeVisible();

    // Get initial theme
    const htmlElement = page.locator("html");
    const initialTheme = await htmlElement.getAttribute("class");

    // Toggle theme
    await themeToggle.click();

    // Verify theme changed
    await expect(htmlElement).not.toHaveClass(initialTheme || "");
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

    // Check mobile menu button is visible
    await expect(page.getByRole("button", { name: /menu/i })).toBeVisible();

    // Click mobile menu
    await page.getByRole("button", { name: /menu/i }).click();

    // Check navigation items are visible in mobile menu
    await expect(page.getByRole("link", { name: /Login/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Sign up/i })).toBeVisible();
  });
});
