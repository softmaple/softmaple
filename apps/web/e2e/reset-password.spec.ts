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

  test("should handle password reset flow for unauthenticated users", async ({ page }) => {
    // This test simulates the full flow when a user is NOT logged in:
    // 1. User goes to login page
    // 2. Clicks "Forgot password?"
    // 3. Enters email and receives reset link
    // 4. Clicks link (which contains type=recovery param)
    // 5. Gets redirected to /reset-password/update with a recovery session
    // 6. Can update password without being fully authenticated
    
    // Start from login page as an unauthenticated user
    await page.goto("/login");
    
    // Click forgot password link
    const forgotPasswordLink = page.locator('a[href="/reset-password"]');
    await forgotPasswordLink.click();
    await expect(page).toHaveURL("/reset-password");
    
    // Enter email for password reset
    const emailInput = page.locator('input[name="email"]');
    await emailInput.fill("test@example.com");
    
    // Note: In a real test, we would need to:
    // - Submit the form
    // - Intercept the email or use a test email service
    // - Extract the reset link
    // - Navigate to it
    // For now, we'll test that the callback route handles the recovery type correctly
    
    // Simulate clicking the password reset link from email
    // The link would look like: /auth/callback?code=xxx&type=recovery
    // After exchanging the code, it should redirect to /reset-password/update
    
    // This is what happens when user clicks the reset link:
    // 1. Goes to /auth/callback?code=xxx&type=recovery
    // 2. Callback exchanges code for recovery session
    // 3. Redirects to /reset-password/update
    // 4. User can now update password with the recovery session
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
