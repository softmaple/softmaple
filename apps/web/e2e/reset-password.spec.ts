import { test, expect } from "@playwright/test";

test.describe("Password Reset Flow", () => {
  test("should display the reset password page", async ({ page }) => {
    await page.goto("/reset-password");

    // Check page title
    await expect(page.locator(".text-2xl")).toContainText("Reset your password");
    
    // Check description
    await expect(page.locator("text=Enter your email address")).toBeVisible();
    
    // Check form elements
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toContainText("Send reset link");
    
    // Check link back to login
    await expect(page.locator('a[href="/login"]')).toContainText("Sign in");
  });

  test("should show forgot password link on login page", async ({ page }) => {
    await page.goto("/login");
    
    const forgotPasswordLink = page.locator('a[href="/reset-password"]');
    await expect(forgotPasswordLink).toBeVisible();
    await expect(forgotPasswordLink).toContainText("Forgot password?");
    
    // Test navigation
    await forgotPasswordLink.click();
    await expect(page).toHaveURL("/reset-password");
  });

  test("should validate email input", async ({ page }) => {
    await page.goto("/reset-password");

    // Try submitting without email
    await page.locator('button[type="submit"]').click();
    
    // HTML5 validation should prevent submission
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toHaveAttribute("required");
    
    // Try invalid email format
    await emailInput.fill("invalid-email");
    await page.locator('button[type="submit"]').click();
    
    // Browser should validate email format
    const validity = await emailInput.evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(validity).toBe(false);
  });

  test("should display the update password page", async ({ page }) => {
    await page.goto("/reset-password/update");

    // Check page title
    await expect(page.locator(".text-2xl")).toContainText("Create new password");
    
    // Check form elements
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('input[name="confirmPassword"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toContainText("Update password");
    
    // Check link back to login
    await expect(page.locator('a[href="/login"]')).toContainText("Back to sign in");
  });

  test("should validate password matching on update page", async ({ page }) => {
    await page.goto("/reset-password/update");

    const passwordInput = page.locator('input[name="password"]');
    const confirmPasswordInput = page.locator('input[name="confirmPassword"]');
    
    // Enter different passwords
    await passwordInput.fill("password123");
    await confirmPasswordInput.fill("password456");
    
    // Check for error message
    await expect(page.locator("text=Passwords do not match")).toBeVisible();
    
    // Check button is disabled
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  });

  test("should validate minimum password length", async ({ page }) => {
    await page.goto("/reset-password/update");

    const passwordInput = page.locator('input[name="password"]');
    const confirmPasswordInput = page.locator('input[name="confirmPassword"]');
    
    // Enter short passwords
    await passwordInput.fill("12345");
    await confirmPasswordInput.fill("12345");
    
    // Check button is disabled when passwords are too short
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    
    // Additionally check if error message appears
    const errorText = page.locator(".text-red-600");
    // Wait for the error message to appear and be visible
    await expect(errorText.first()).toBeVisible();
  });

  test("should navigate to reset password form from login page", async ({ page }) => {
    // This test verifies the navigation flow from login to password reset
    // Note: Full email-based password reset testing requires email interception infrastructure
    // (e.g., MailSlurp, test SMTP server) which is not currently implemented.
    // TODO: Implement full E2E password reset flow when email testing is available.
    
    // Start from login page
    await page.goto("/login");
    
    // Verify forgot password link exists
    const forgotPasswordLink = page.locator('a[href="/reset-password"]');
    await expect(forgotPasswordLink).toBeVisible();
    await expect(forgotPasswordLink).toContainText("Forgot password?");
    
    // Navigate to reset password page
    await forgotPasswordLink.click();
    await expect(page).toHaveURL("/reset-password");
    
    // Verify reset password form is displayed
    await expect(page.locator(".text-2xl")).toContainText("Reset your password");
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toBeVisible();
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toContainText("Send reset link");
    
    // Test that the form can be filled
    await emailInput.fill("test@example.com");
    await expect(emailInput).toHaveValue("test@example.com");
  });

  test.skip("should complete full password reset flow with email verification", async ({ page }) => {
    // SKIPPED: This test requires email interception infrastructure
    // When implemented, this test should:
    // 1. Request password reset for a test user
    // 2. Intercept the reset email (using MailSlurp, test SMTP, etc.)
    // 3. Extract the reset link from the email
    // 4. Navigate to the reset link (/auth/callback?code=xxx&type=recovery)
    // 5. Verify redirect to /reset-password/update
    // 6. Enter new password
    // 7. Verify password was updated (attempt login with new password)
    
    // Implementation example:
    // const testEmail = await mailSlurp.createInbox();
    // await page.goto("/reset-password");
    // await page.fill('input[name="email"]', testEmail.emailAddress);
    // await page.click('button[type="submit"]');
    // const email = await mailSlurp.waitForLatestEmail(testEmail.id);
    // const resetLink = extractResetLink(email.body);
    // await page.goto(resetLink);
    // await expect(page).toHaveURL("/reset-password/update");
    // await page.fill('input[name="password"]', "newPassword123");
    // await page.fill('input[name="confirmPassword"]', "newPassword123");
    // await page.click('button[type="submit"]');
    // await expect(page).toHaveURL("/login");
    
    // Placeholder assertion to make the test valid when skipped
    expect(true).toBe(true);
  });

  test("should enable submit button with valid passwords", async ({ page }) => {
    await page.goto("/reset-password/update");

    const passwordInput = page.locator('input[name="password"]');
    const confirmPasswordInput = page.locator('input[name="confirmPassword"]');
    const submitButton = page.locator('button[type="submit"]');
    
    // Initially disabled (empty fields)
    await expect(submitButton).toBeDisabled();
    
    // Enter valid matching passwords
    await passwordInput.fill("validPassword123");
    await confirmPasswordInput.fill("validPassword123");
    
    // Wait for button to become enabled after validation completes
    await expect(submitButton).toBeEnabled();
    
    // Also verify no error messages are present
    const errorText = page.locator(".text-red-600");
    await expect(errorText).toHaveCount(0);
  });
});
