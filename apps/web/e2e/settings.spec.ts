import { test, expect, Page } from "@playwright/test";

import { mockAuthentication } from "./helpers/auth";

test.describe("User Settings", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthentication(page);
  });

  test("should navigate to settings page", async ({ page }) => {
    await page.goto("/dashboard");

    // Click on user menu
    await page.getByRole("button", { name: /User menu/i }).click();

    // Click settings
    await page.getByRole("menuitem", { name: /Settings/i }).click();

    // Verify navigation
    await expect(page).toHaveURL("/settings/profile");
    await expect(
      page.getByRole("heading", { name: /Settings/i }),
    ).toBeVisible();
  });

  test("should display profile settings", async ({ page }) => {
    await page.goto("/settings/profile");

    // Check profile form fields
    await expect(page.getByLabel(/Full Name/i)).toBeVisible();
    await expect(page.getByLabel(/Email/i)).toBeVisible();
    await expect(page.getByLabel(/Bio/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Upload Avatar/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Save Changes/i }),
    ).toBeVisible();
  });

  test("should update profile information", async ({ page }) => {
    await page.goto("/settings/profile");

    // Update name
    const nameInput = page.getByLabel(/Full Name/i);
    await nameInput.clear();
    await nameInput.fill("Updated Name");

    // Update bio
    const bioInput = page.getByLabel(/Bio/i);
    await bioInput.clear();
    await bioInput.fill("This is my updated bio");

    // Save changes
    await page.getByRole("button", { name: /Save Changes/i }).click();

    // Verify success message
    await expect(page.getByText(/Profile updated successfully/i)).toBeVisible();
  });

  test("should display account settings", async ({ page }) => {
    await page.goto("/settings/account");

    // Check account settings sections
    await expect(page.getByText(/Change Password/i)).toBeVisible();
    await expect(page.getByText(/Two-Factor Authentication/i)).toBeVisible();
    await expect(page.getByText(/Delete Account/i)).toBeVisible();
  });

  test("should change password", async ({ page }) => {
    await page.goto("/settings/account");

    // Fill password change form
    await page.getByLabel(/Current Password/i).fill("currentpass123");
    await page.getByLabel(/New Password/i).fill("newpass123");
    await page.getByLabel(/Confirm New Password/i).fill("newpass123");

    // Submit
    await page.getByRole("button", { name: /Change Password/i }).click();

    // Verify success
    await expect(
      page.getByText(/Password changed successfully/i),
    ).toBeVisible();
  });

  test("should display notification preferences", async ({ page }) => {
    await page.goto("/settings/notifications");

    // Check notification options
    await expect(page.getByLabel(/Email notifications/i)).toBeVisible();
    await expect(page.getByLabel(/Push notifications/i)).toBeVisible();
    await expect(page.getByLabel(/Document updates/i)).toBeVisible();
    await expect(page.getByLabel(/Comments and mentions/i)).toBeVisible();
    await expect(page.getByLabel(/Weekly digest/i)).toBeVisible();
  });

  test("should update notification preferences", async ({ page }) => {
    await page.goto("/settings/notifications");

    // Toggle notifications
    await page.getByLabel(/Email notifications/i).click();
    await page.getByLabel(/Push notifications/i).click();
    await page.getByLabel(/Weekly digest/i).click();

    // Save
    await page.getByRole("button", { name: /Save Preferences/i }).click();

    // Verify
    await expect(
      page.getByText(/Notification preferences updated/i),
    ).toBeVisible();
  });

  test("should display appearance settings", async ({ page }) => {
    await page.goto("/settings/appearance");

    // Check theme options
    await expect(page.getByText(/Theme/i)).toBeVisible();
    await expect(page.getByRole("radio", { name: /Light/i })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Dark/i })).toBeVisible();
    await expect(page.getByRole("radio", { name: /System/i })).toBeVisible();

    // Check font options
    await expect(page.getByLabel(/Font Size/i)).toBeVisible();
    await expect(page.getByLabel(/Editor Font/i)).toBeVisible();
  });

  test("should change theme", async ({ page }) => {
    await page.goto("/settings/appearance");

    // Get initial theme
    const htmlElement = page.locator("html");
    const initialTheme = await htmlElement.getAttribute("class");

    // Change to dark theme
    await page.getByRole("radio", { name: /Dark/i }).click();

    // Verify theme changed
    await expect(htmlElement).toHaveClass(/dark/);

    // Change to light theme
    await page.getByRole("radio", { name: /Light/i }).click();

    // Verify theme changed
    await expect(htmlElement).not.toHaveClass(/dark/);
  });

  test("should display keyboard shortcuts", async ({ page }) => {
    await page.goto("/settings/shortcuts");

    // Check shortcuts list
    await expect(page.getByText(/Keyboard Shortcuts/i)).toBeVisible();
    await expect(page.getByText(/Bold.*Ctrl\+B/i)).toBeVisible();
    await expect(page.getByText(/Italic.*Ctrl\+I/i)).toBeVisible();
    await expect(page.getByText(/Save.*Ctrl\+S/i)).toBeVisible();
    await expect(page.getByText(/Undo.*Ctrl\+Z/i)).toBeVisible();
  });
});

test.describe("Workspace Settings", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthentication(page);
  });

  test("should display workspace general settings", async ({ page }) => {
    await page.goto("/workspace/test-workspace/settings");

    // Check general settings
    await expect(page.getByLabel(/Workspace Name/i)).toBeVisible();
    await expect(page.getByLabel(/Workspace Description/i)).toBeVisible();
    await expect(page.getByLabel(/Workspace URL/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Save Changes/i }),
    ).toBeVisible();
  });

  test("should update workspace name", async ({ page }) => {
    await page.goto("/workspace/test-workspace/settings");

    // Update name
    const nameInput = page.getByLabel(/Workspace Name/i);
    await nameInput.clear();
    await nameInput.fill("Updated Workspace");

    // Save
    await page.getByRole("button", { name: /Save Changes/i }).click();

    // Verify
    await expect(
      page.getByText(/Workspace updated successfully/i),
    ).toBeVisible();
  });

  test("should manage workspace members", async ({ page }) => {
    await page.goto("/workspace/test-workspace/settings/members");

    // Check members section
    await expect(page.getByText(/Members/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Invite Member/i }),
    ).toBeVisible();

    // Check member list
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText(/test@example.com/i)).toBeVisible();
  });

  test("should invite new member", async ({ page }) => {
    await page.goto("/workspace/test-workspace/settings/members");

    // Click invite
    await page.getByRole("button", { name: /Invite Member/i }).click();

    // Fill invite form
    await page.getByLabel(/Email/i).fill("newuser@example.com");
    await page.getByLabel(/Role/i).selectOption("editor");

    // Send invite
    await page.getByRole("button", { name: /Send Invite/i }).click();

    // Verify
    await expect(
      page.getByText(/Invitation sent to newuser@example.com/i),
    ).toBeVisible();
  });

  test("should manage workspace permissions", async ({ page }) => {
    await page.goto("/workspace/test-workspace/settings/permissions");

    // Check permissions settings
    await expect(page.getByText(/Permissions/i)).toBeVisible();
    await expect(page.getByLabel(/Who can create documents/i)).toBeVisible();
    await expect(page.getByLabel(/Who can delete documents/i)).toBeVisible();
    await expect(page.getByLabel(/Who can invite members/i)).toBeVisible();
  });

  test("should display workspace billing", async ({ page }) => {
    await page.goto("/workspace/test-workspace/settings/billing");

    // Check billing information
    await expect(page.getByText(/Current Plan/i)).toBeVisible();
    await expect(page.getByText(/Usage/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Upgrade Plan/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Manage Subscription/i }),
    ).toBeVisible();
  });
});
