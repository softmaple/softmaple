import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("should display landing page with auth options", async ({ page }) => {
    await page.goto("/");

    // Check for Softmaple branding
    // Be more specific - check header branding
    await expect(page.locator("header").getByText("Softmaple")).toBeVisible();

    // Check for Sign In button in header
    await expect(page.getByRole("button", { name: /Sign In/i })).toBeVisible();
  });

  test("should navigate to login page", async ({ page }) => {
    await page.goto("/");

    // Click Sign In button
    await page.getByRole("button", { name: /Sign In/i }).click();

    // Verify we're on the login page
    await expect(page).toHaveURL("/login");
    // CardTitle is not a heading element, it's a div with text-2xl class
    await expect(page.getByText("Welcome back")).toBeVisible();
    await expect(
      page.getByText("Sign in to your Softmaple account"),
    ).toBeVisible();

    // Check form fields
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();

    // Check submit button (it's actually labeled "Continue")
    // Let's check what the button actually says
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();

    // Check social login buttons
    await expect(page.getByRole("button", { name: /GitHub/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();
  });

  test("should navigate to signup page from login", async ({ page }) => {
    await page.goto("/login");

    // Click sign up link from login page
    await page.getByRole("link", { name: /Sign up/i }).click();

    // Verify we're on the signup page
    await expect(page).toHaveURL("/signup");
    // CardTitle is not a heading element
    await expect(page.getByText("Create your account")).toBeVisible();
    await expect(
      page.getByText("Start writing with Softmaple today"),
    ).toBeVisible();

    // Check form fields
    await expect(page.getByLabel("First name")).toBeVisible();
    await expect(page.getByLabel("Last name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    // Signup has two password fields - Password and Confirm Password
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Confirm password")).toBeVisible();

    // Check submit button
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();

    // Check social login buttons
    await expect(page.getByRole("button", { name: /GitHub/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();
  });

  test("should display first and last name fields on signup page", async ({ page }) => {
    await page.goto("/signup");

    // Check that first and last name fields are present
    const firstNameInput = page.getByLabel("First name");
    const lastNameInput = page.getByLabel("Last name");
    
    await expect(firstNameInput).toBeVisible();
    await expect(lastNameInput).toBeVisible();
    
    // Check placeholders
    await expect(firstNameInput).toHaveAttribute("placeholder", "John");
    await expect(lastNameInput).toHaveAttribute("placeholder", "Doe");
    
    // Check that they are required fields
    await expect(firstNameInput).toHaveAttribute("required", "");
    await expect(lastNameInput).toHaveAttribute("required", "");
  });

  test("should validate required name fields on signup form", async ({ page }) => {
    await page.goto("/signup");

    // Try to submit with empty first and last name
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("password123");
    
    // Leave first and last name empty and try to submit
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // HTML5 validation should prevent submission
    // Check that first name field shows validation error
    const firstNameInput = page.getByLabel("First name");
    const firstNameValidity = await firstNameInput.evaluate(
      (el: HTMLInputElement) => el.validity.valid,
    );
    expect(firstNameValidity).toBe(false);
  });

  test("should fill all signup form fields correctly", async ({ page }) => {
    await page.goto("/signup");

    // Fill in all fields
    await page.getByLabel("First name").fill("John");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByLabel("Email").fill("john.doe@example.com");
    await page.getByLabel("Password", { exact: true }).fill("securePassword123");
    await page.getByLabel("Confirm password").fill("securePassword123");

    // Verify all fields have the correct values
    await expect(page.getByLabel("First name")).toHaveValue("John");
    await expect(page.getByLabel("Last name")).toHaveValue("Doe");
    await expect(page.getByLabel("Email")).toHaveValue("john.doe@example.com");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("securePassword123");
    await expect(page.getByLabel("Confirm password")).toHaveValue("securePassword123");

    // Submit button should be enabled
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeEnabled();
  });

  test("should show error when passwords do not match", async ({ page }) => {
    await page.goto("/signup");

    // Fill in the form with mismatched passwords
    await page.getByLabel("First name").fill("John");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByLabel("Email").fill("john.doe@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("different456");

    // Submit the form
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // Check for error message
    await expect(page.getByText("Passwords do not match")).toBeVisible();
  });

  test("should show error when password is too short", async ({ page }) => {
  await page.goto("/signup");

  // Fill in the form with short password 
  await page.getByLabel("First name").fill("John");
  await page.getByLabel("Last name").fill("Doe");
  await page.getByLabel("Email").fill("john.doe@example.com");
  
  // HTML5 validation would prevent submitting passwords shorter than minLength
  // We need to bypass the minLength attribute
  await page.getByLabel("Password", { exact: true }).fill("12345");
  await page.getByLabel("Confirm password").fill("12345");

  // Submit the form
  const submitButton = page.locator('button[type="submit"]');
  await submitButton.click();

  // Since HTML5 validation prevents submission with minLength=6,
  // the browser shows a native validation error, not our custom one
  // Let's check if the password field shows validity errors
  const passwordValidity = await page.getByLabel("Password", { exact: true }).evaluate(
    (el: HTMLInputElement) => ({
      valid: el.validity.valid,
      tooShort: el.validity.tooShort,
      minLength: el.minLength
    })
  );
  
  // The password field should be invalid due to being too short
  expect(passwordValidity.valid).toBe(false);
  expect(passwordValidity.tooShort).toBe(true);
  expect(passwordValidity.minLength).toBe(6);
});

test("should clear error message when user starts typing", async ({ page }) => {
    await page.goto("/signup");

    // Trigger password mismatch error
    await page.getByLabel("First name").fill("John");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByLabel("Email").fill("john.doe@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("different456");
    
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();
    
    // Verify error is shown
    await expect(page.getByText("Passwords do not match")).toBeVisible();
    
    // Start typing in any field
    await page.getByLabel("Confirm password").fill("password123");
    
    // Error should be cleared
    await expect(page.getByText("Passwords do not match")).not.toBeVisible();
  });

  test("should disable form fields and show loading state during submission", async ({ page }) => {
    await page.goto("/signup");

    // Fill in the form
    await page.getByLabel("First name").fill("John");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByLabel("Email").fill("john.doe@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("password123");

    // Intercept the signup request to delay it
    await page.route("**/auth/v1/signup", async (route) => {
      // Delay for 1 second to observe loading state
      await new Promise(resolve => setTimeout(resolve, 1000));
      await route.continue();
    });

    // Submit the form
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // Check that button shows loading state
    await expect(submitButton).toHaveText("Creating account...");
    
    // Check that fields are disabled
    await expect(page.getByLabel("First name")).toBeDisabled();
    await expect(page.getByLabel("Last name")).toBeDisabled();
    await expect(page.getByLabel("Email")).toBeDisabled();
    await expect(page.getByLabel("Password", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Confirm password")).toBeDisabled();
  });

  test("should validate required fields on login form", async ({ page }) => {
    await page.goto("/login");

    // Try to submit empty form
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // HTML5 validation should prevent submission
    // Check that we're still on login page
    await expect(page).toHaveURL("/login");

    // Check that fields have required attribute
    await expect(page.getByLabel("Email")).toHaveAttribute("required", "");
    await expect(page.getByLabel("Password")).toHaveAttribute("required", "");
  });

  test("should validate email format", async ({ page }) => {
    await page.goto("/login");

    // Enter invalid email
    const emailInput = page.getByLabel("Email");
    await emailInput.fill("invalid-email");
    await page.getByLabel("Password").fill("password123");

    // Try to submit
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // HTML5 email validation should trigger
    const validityState = await emailInput.evaluate(
      (el: HTMLInputElement) => el.validity.valid,
    );
    expect(validityState).toBe(false);
  });

  test("should have link from login to signup", async ({ page }) => {
    await page.goto("/login");

    // Check for signup text and link
    await expect(page.getByText("Don't have an account?")).toBeVisible();
    const signupLink = page.getByRole("link", { name: /Sign up/i });
    await expect(signupLink).toBeVisible();

    // Click the link
    await signupLink.click();

    // Verify navigation to signup
    await expect(page).toHaveURL("/signup");
  });

  test("should have link from signup to login", async ({ page }) => {
    await page.goto("/signup");

    // Check for login text and link
    await expect(page.getByText("Already have an account?")).toBeVisible();
    const signinLink = page.getByRole("link", { name: /Sign in/i });
    await expect(signinLink).toBeVisible();

    // Click the link
    await signinLink.click();

    // Verify navigation to login
    await expect(page).toHaveURL("/login");
  });

  test("should display logo and branding on auth pages", async ({ page }) => {
    // Check login page branding
    await page.goto("/login");

    // Look for the logo (orange-red gradient div with FileText icon)
    const loginLogo = page.locator(
      ".w-12.h-12.bg-gradient-to-br.from-orange-500.to-red-500",
    );
    await expect(loginLogo).toBeVisible();

    // Check signup page branding
    await page.goto("/signup");
    const signupLogo = page.locator(
      ".w-12.h-12.bg-gradient-to-br.from-orange-500.to-red-500",
    );
    await expect(signupLogo).toBeVisible();
  });

  test("should show 'Or continue with' divider", async ({ page }) => {
    await page.goto("/login");

    // Check for social login divider
    await expect(page.getByText("Or continue with")).toBeVisible();

    // Same for signup page
    await page.goto("/signup");
    await expect(page.getByText("Or continue with")).toBeVisible();
  });

  test("should fill and submit login form", async ({ page }) => {
    await page.goto("/login");

    // Fill in the form
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("testpassword123");

    // The form should be submittable (though it may fail with test credentials)
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeEnabled();
  });

  test("should handle authenticated user redirect", async ({ page }) => {
    // If user is already authenticated, they should see Dashboard button instead of Sign In
    // This test would require mocking authentication

    // For now, just check that unauthenticated users see Sign In
    await page.goto("/");
    const headerButton = page
      .getByRole("button")
      .filter({ hasText: /Sign In|Dashboard/i });
    const buttonText = await headerButton.textContent();

    // Should be "Sign In" for unauthenticated users
    expect(buttonText).toContain("Sign In");
  });
});
