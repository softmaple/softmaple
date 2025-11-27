import { test, expect, Page } from "@playwright/test";
import { mockAuthentication } from "./helpers/auth";
import { mockAllServices, mockFastNetwork } from "./helpers/mock-services";

test.describe("Workspace", () => {
  test.describe("Authenticated User Flow", () => {
    test.beforeEach(async ({ page }) => {
      // Set up all mocks before authentication
      await mockAllServices(page);
      await mockFastNetwork(page);
      await mockAuthentication(page);
    });

    test("should display dashboard after authentication", async ({ page }) => {
      await page.goto("/dashboard");

      // Check dashboard elements
      await expect(
        page.getByRole("heading", { name: /Dashboard/i }),
      ).toBeVisible();
      await expect(page.getByText(/Recent Documents/i)).toBeVisible();
      await expect(
        page.getByRole("button", { name: /New Document/i }),
      ).toBeVisible();
    });

    test("should navigate to workspace", async ({ page }) => {
      await page.goto("/workspace/test-workspace");

      // Check workspace page elements
      await expect(
        page.getByRole("heading", { name: /Workspace/i }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Create Document/i }),
      ).toBeVisible();
    });

    test("should display workspace settings", async ({ page }) => {
      await page.goto("/workspace/test-workspace/settings");

      // Check settings page
      await expect(
        page.getByRole("heading", { name: /Settings/i }),
      ).toBeVisible();
      await expect(page.getByText(/Workspace Name/i)).toBeVisible();
      await expect(page.getByText(/Members/i)).toBeVisible();
    });

    test("should show create document modal", async ({ page }) => {
      await page.goto("/workspace/test-workspace");

      // Click create document button
      await page.getByRole("button", { name: /Create Document/i }).click();

      // Check modal appears
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByLabel(/Document Title/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /Create/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /Cancel/i })).toBeVisible();
    });

    test("should filter documents by search", async ({ page }) => {
      await page.goto("/workspace/test-workspace");

      // Find search input
      const searchInput = page.getByPlaceholder(/Search documents/i);
      await expect(searchInput).toBeVisible();

      // Type search query
      await searchInput.fill("test document");

      // Verify search is working (URL or content update)
      await expect(
        page.getByText(/Searching/i).or(page.getByText(/Results/i)),
      ).toBeVisible();
    });

    test("should sort documents", async ({ page }) => {
      await page.goto("/workspace/test-workspace");

      // Find sort dropdown
      const sortButton = page.getByRole("button", { name: /Sort/i });
      await expect(sortButton).toBeVisible();

      // Click to open sort options
      await sortButton.click();

      // Check sort options
      await expect(
        page.getByRole("option", { name: /Date Created/i }),
      ).toBeVisible();
      await expect(
        page.getByRole("option", { name: /Last Modified/i }),
      ).toBeVisible();
      await expect(
        page.getByRole("option", { name: /Alphabetical/i }),
      ).toBeVisible();
    });
  });

  test.describe("Unauthenticated User", () => {
    test("should redirect to login from protected routes", async ({ page }) => {
      // Try to access dashboard
      await page.goto("/dashboard");
      await expect(page).toHaveURL("/login");

      // Try to access workspace
      await page.goto("/workspace/test-workspace");
      await expect(page).toHaveURL("/login");
    });

    test("should show coming soon page for unavailable features", async ({
      page,
    }) => {
      await page.goto("/coming-soon");

      await expect(
        page.getByRole("heading", { name: /Coming Soon/i }),
      ).toBeVisible();
      await expect(
        page.getByText(/This feature is under development/i),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: /Go Back/i })).toBeVisible();
    });
  });
});
