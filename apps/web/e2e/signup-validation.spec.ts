import { test, expect } from "@playwright/test";

test.describe("Signup Form Validation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/signup");
  });

  test("should display all required fields including names", async ({
    page,
  }) => {
    // Check that all fields are present
    await expect(page.getByLabel("First name")).toBeVisible();
    await expect(page.getByLabel("Last name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Confirm password")).toBeVisible();

    // Check placeholders
    await expect(page.getByLabel("First name")).toHaveAttribute(
      "placeholder",
      "John",
    );
    await expect(page.getByLabel("Last name")).toHaveAttribute(
      "placeholder",
      "Doe",
    );
    await expect(page.getByLabel("Email")).toHaveAttribute(
      "placeholder",
      "you@example.com",
    );

    // Check that fields are required
    await expect(page.getByLabel("First name")).toHaveAttribute("required", "");
    await expect(page.getByLabel("Last name")).toHaveAttribute("required", "");
    await expect(page.getByLabel("Email")).toHaveAttribute("required", "");
  });

  test("should validate password mismatch", async ({ page }) => {
    // Fill form with mismatched passwords
    await page.getByLabel("First name").fill("Test");
    await page.getByLabel("Last name").fill("User");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("different456");

    // Submit form
    await page.locator('button[type="submit"]').click();

    // Should show error message
    await expect(
      page.locator("div").filter({ hasText: "Passwords do not match" }).first(),
    ).toBeVisible();

    // Form should not be disabled (error state)
    await expect(page.getByLabel("First name")).toBeEnabled();
    await expect(page.getByLabel("Last name")).toBeEnabled();
  });

  test("should validate password minimum length", async ({ page }) => {
    // Fill form with short password
    await page.getByLabel("First name").fill("Test");
    await page.getByLabel("Last name").fill("User");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password", { exact: true }).fill("12345");
    await page.getByLabel("Confirm password").fill("12345");

    // Submit form
    await page.locator('button[type="submit"]').click();

    // HTML5 validation prevents submission with minLength=6
    // Check that the password field is invalid
    const passwordValidity = await page
      .getByLabel("Password", { exact: true })
      .evaluate((el: HTMLInputElement) => ({
        valid: el.validity.valid,
        tooShort: el.validity.tooShort,
        minLength: el.minLength,
      }));

    // The password field should be invalid due to being too short
    expect(passwordValidity.valid).toBe(false);
    expect(passwordValidity.tooShort).toBe(true);
    expect(passwordValidity.minLength).toBe(6);
  });

  test("should clear error when user starts typing", async ({ page }) => {
    // Trigger password mismatch error
    await page.getByLabel("First name").fill("Test");
    await page.getByLabel("Last name").fill("User");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("different456");

    await page.locator('button[type="submit"]').click();

    // Verify error is shown
    await expect(
      page.locator("div").filter({ hasText: "Passwords do not match" }).first(),
    ).toBeVisible();

    // Start typing in any field
    await page.getByLabel("Confirm password").fill("password");

    // Error should be cleared
    await expect(
      page.locator("div").filter({ hasText: "Passwords do not match" }).first(),
    ).not.toBeVisible();
  });

  test("should preserve form data when validation fails", async ({ page }) => {
    // Fill form with mismatched passwords
    await page.getByLabel("First name").fill("John");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByLabel("Email").fill("john@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("wrongpassword");

    // Submit form
    await page.locator('button[type="submit"]').click();

    // Should show error
    await expect(
      page.locator("div").filter({ hasText: "Passwords do not match" }).first(),
    ).toBeVisible();

    // Form data should be preserved
    await expect(page.getByLabel("First name")).toHaveValue("John");
    await expect(page.getByLabel("Last name")).toHaveValue("Doe");
    await expect(page.getByLabel("Email")).toHaveValue("john@example.com");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
      "password123",
    );
    await expect(page.getByLabel("Confirm password")).toHaveValue(
      "wrongpassword",
    );
  });

  test("should handle names with special characters", async ({ page }) => {
    // Fill names with special characters
    await page.getByLabel("First name").fill("Jean-François");
    await page.getByLabel("Last name").fill("O'Brien");
    await page.getByLabel("Email").fill("jean@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("password123");

    // Verify the fields accept special characters
    await expect(page.getByLabel("First name")).toHaveValue("Jean-François");
    await expect(page.getByLabel("Last name")).toHaveValue("O'Brien");

    // Submit button should be enabled
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
  });

  test("should validate required fields with HTML5 validation", async ({
    page,
  }) => {
    // Try to submit with empty required fields
    await page.locator('button[type="submit"]').click();

    // Check HTML5 validation on first name field
    const firstNameValidity = await page
      .getByLabel("First name")
      .evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(firstNameValidity).toBe(false);
  });

  test("should disable form during submission", async ({ page }) => {
    // Fill valid form data
    await page.getByLabel("First name").fill("Test");
    await page.getByLabel("Last name").fill("User");
    await page.getByLabel("Email").fill("testuser@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("password123");

    // Submit form
    await page.locator('button[type="submit"]').click();

    // All fields should be disabled during submission
    await expect(page.getByLabel("First name")).toBeDisabled();
    await expect(page.getByLabel("Last name")).toBeDisabled();
    await expect(page.getByLabel("Email")).toBeDisabled();
    await expect(page.getByLabel("Password", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Confirm password")).toBeDisabled();
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  });
});
