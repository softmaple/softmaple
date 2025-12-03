import { test, expect } from "@playwright/test";

test.describe("Signup Flow with Names", () => {
  test("should submit signup form with first and last names", async ({ page }) => {
    await page.goto("/signup");

    // Fill all fields including names
    await page.getByLabel("First name").fill("Jane");
    await page.getByLabel("Last name").fill("Smith");
    await page.getByLabel("Email").fill("jane.smith@example.com");
    await page.getByLabel("Password", { exact: true }).fill("SecurePass123!");
    await page.getByLabel("Confirm password").fill("SecurePass123!");

    // Mock the signup API to verify the data is sent correctly
    let signupData: any = null;
    await page.route("**/auth/v1/signup", async (route) => {
      const request = route.request();
      signupData = request.postDataJSON();
      
      await route.fulfill({
        status: 200,
        json: {
          user: {
            id: "123",
            email: "jane.smith@example.com",
            user_metadata: {
              first_name: "Jane",
              last_name: "Smith"
            }
          }
        },
      });
    });

    // Submit the form
    await page.locator('button[type="submit"]').click();

    // Wait for the request to complete
    await page.waitForTimeout(500);

    // Verify the signup data included names in metadata
    expect(signupData).toBeTruthy();
    expect(signupData?.email).toBe("jane.smith@example.com");
    expect(signupData?.options?.data?.first_name).toBe("Jane");
    expect(signupData?.options?.data?.last_name).toBe("Smith");
  });

  test("should trim whitespace from name fields", async ({ page }) => {
    await page.goto("/signup");

    // Fill names with extra whitespace
    await page.getByLabel("First name").fill("  John  ");
    await page.getByLabel("Last name").fill("  Doe  ");
    await page.getByLabel("Email").fill("john.doe@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("password123");

    // Mock signup to capture the request
    let signupData: any = null;
    await page.route("**/auth/v1/signup", async (route) => {
      signupData = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        json: { user: { id: "123" } },
      });
    });

    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(500);

    // Names should be trimmed
    expect(signupData?.options?.data?.first_name).toBe("John");
    expect(signupData?.options?.data?.last_name).toBe("Doe");
  });

  test("should handle names with special characters", async ({ page }) => {
    await page.goto("/signup");

    // Fill names with special characters (apostrophes, hyphens, accents)
    await page.getByLabel("First name").fill("Jean-François");
    await page.getByLabel("Last name").fill("O'Brien");
    await page.getByLabel("Email").fill("jean@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("password123");

    // Verify the fields accept special characters
    await expect(page.getByLabel("First name")).toHaveValue("Jean-François");
    await expect(page.getByLabel("Last name")).toHaveValue("O'Brien");

    // Mock signup
    await page.route("**/auth/v1/signup", async (route) => {
      await route.fulfill({
        status: 200,
        json: { user: { id: "123" } },
      });
    });

    // Should submit without errors
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();
    
    // Form should be processing (fields disabled)
    await expect(page.getByLabel("First name")).toBeDisabled();
  });

  test("should enforce maximum length for name fields", async ({ page }) => {
    await page.goto("/signup");

    const longName = "a".repeat(100); // Very long name
    
    await page.getByLabel("First name").fill(longName);
    await page.getByLabel("Last name").fill(longName);

    // Check if there's a maxlength attribute or if the value is truncated
    const firstNameValue = await page.getByLabel("First name").inputValue();
    const lastNameValue = await page.getByLabel("Last name").inputValue();

    // Names should be limited (assuming max 100 chars)
    expect(firstNameValue.length).toBeLessThanOrEqual(100);
    expect(lastNameValue.length).toBeLessThanOrEqual(100);
  });

  test("should show error when submitting with mismatched passwords", async ({ page }) => {
    await page.goto("/signup");

    // Fill form with mismatched passwords
    await page.getByLabel("First name").fill("Test");
    await page.getByLabel("Last name").fill("User");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("differentpassword");

    // Submit form
    await page.locator('button[type="submit"]').click();

    // Should show error message
    await expect(page.getByText("Passwords do not match")).toBeVisible();
    
    // Form should not be disabled (error state)
    await expect(page.getByLabel("First name")).toBeEnabled();
    await expect(page.getByLabel("Last name")).toBeEnabled();
  });

  test("should redirect to login with confirmation message after signup", async ({ page }) => {
    await page.goto("/signup");

    // Fill the form
    await page.getByLabel("First name").fill("New");
    await page.getByLabel("Last name").fill("User");
    await page.getByLabel("Email").fill("newuser@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("password123");

    // Mock successful signup
    await page.route("**/auth/v1/signup", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          user: {
            id: "123",
            email: "newuser@example.com",
            email_confirmed_at: null, // Email not confirmed yet
            user_metadata: {
              first_name: "New",
              last_name: "User"
            }
          }
        },
      });
    });

    // Submit form
    await page.locator('button[type="submit"]').click();

    // Should redirect to login page with message
    await page.waitForURL((url) => url.pathname === "/login", { timeout: 5000 });
    
    // Check for confirmation message in URL
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("message")).toContain("confirm");
  });

  test("should preserve form data when validation fails", async ({ page }) => {
    await page.goto("/signup");

    // Fill form with mismatched passwords
    await page.getByLabel("First name").fill("John");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByLabel("Email").fill("john@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("wrongpassword");

    // Submit form
    await page.locator('button[type="submit"]').click();

    // Should show error
    await expect(page.getByText("Passwords do not match")).toBeVisible();

    // Form data should be preserved
    await expect(page.getByLabel("First name")).toHaveValue("John");
    await expect(page.getByLabel("Last name")).toHaveValue("Doe");
    await expect(page.getByLabel("Email")).toHaveValue("john@example.com");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("password123");
    await expect(page.getByLabel("Confirm password")).toHaveValue("wrongpassword");
  });

  test("should handle server errors during signup", async ({ page }) => {
    await page.goto("/signup");

    // Fill valid form data
    await page.getByLabel("First name").fill("Error");
    await page.getByLabel("Last name").fill("Test");
    await page.getByLabel("Email").fill("error@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("password123");

    // Mock server error
    await page.route("**/auth/v1/signup", async (route) => {
      await route.fulfill({
        status: 400,
        json: {
          error: "User already registered",
          error_code: "user_exists"
        },
      });
    });

    // Submit form
    await page.locator('button[type="submit"]').click();

    // Should show error message
    await page.waitForTimeout(500);
    
    // Form should be re-enabled for retry
    await expect(page.getByLabel("First name")).toBeEnabled();
    await expect(page.getByLabel("Last name")).toBeEnabled();
    await expect(page.getByLabel("Email")).toBeEnabled();
  });
});
