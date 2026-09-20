import { expect, test } from "@playwright/test";

for (const mode of ["login", "signup"] as const) {
  for (const width of [390, 768, 1440]) {
    for (const theme of ["light", "dark"] as const) {
      test(`${mode}: ${width}px ${theme} layout and disabled providers`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: theme });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`/${mode}`);
        await expect(page).toHaveTitle(/Softmaple/);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          mode === "login" ? "Welcome back" : "Create your account",
        );
        await expect(
          page.locator("nextjs-portal [data-nextjs-dialog]"),
        ).toHaveCount(0);
        await expect(
          page.getByText("GitHub and Google sign-in are coming soon.", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "GitHub Soon" }),
        ).toBeDisabled();
        await expect(
          page.getByRole("button", { name: "Google Soon" }),
        ).toBeDisabled();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const email = page.getByLabel("Email", { exact: true });
        const password = page.getByLabel("Password", { exact: true });
        await expect(password).toHaveAttribute(
          "autocomplete",
          mode === "login" ? "current-password" : "new-password",
        );
        const fieldOrder = await page
          .locator('input:not([type="hidden"])')
          .evaluateAll((inputs) =>
            inputs.map((input) => input.getAttribute("name")),
          );
        expect(fieldOrder).toEqual(
          mode === "login"
            ? ["email", "password"]
            : ["firstName", "lastName", "email", "password", "confirmPassword"],
        );
        const originalOrder = await page.evaluate(() => {
          const submit = document.querySelector('button[type="submit"]');
          const provider = document.querySelector(
            'button[aria-describedby="oauth-note"]',
          );
          const forgot = document.querySelector('a[href="/reset-password"]');
          const follows = (first: Element | null, second: Element | null) =>
            Boolean(
              first &&
                second &&
                first.compareDocumentPosition(second) &
                  Node.DOCUMENT_POSITION_FOLLOWING,
            );
          return (
            follows(submit, provider) &&
            (!forgot || (follows(submit, forgot) && follows(forgot, provider)))
          );
        });
        expect(originalOrder).toBe(true);
        const requests: string[] = [];
        page.on("request", (request) => {
          if (request.method() === "POST" || /\/auth\/v1\//.test(request.url()))
            requests.push(request.url());
        });
        for (const provider of ["GitHub", "Google"]) {
          const button = page.getByRole("button", { name: `${provider} Soon` });
          const bounds = await button.boundingBox();
          expect(bounds).not.toBeNull();
          if (bounds)
            await page.mouse.click(
              bounds.x + bounds.width / 2,
              bounds.y + bounds.height / 2,
            );
          await button.evaluate((node) => node.focus());
          await expect(button).not.toBeFocused();
        }
        await page.getByRole("link", { name: "Return home" }).focus();
        await page.keyboard.press("Tab");
        await expect(
          mode === "login"
            ? email
            : page.getByLabel("First name", { exact: true }),
        ).toBeFocused();
        await expect(page.locator(":focus-visible")).toBeVisible();
        await email.fill("reader@example.invalid");
        await password.fill("Draft1234");
        await page
          .getByRole("button", { name: "Show password", exact: true })
          .click();
        await expect(password).toHaveAttribute("type", "text");
        await expect(password).toHaveValue("Draft1234");
        await page
          .getByRole("button", { name: "Hide password", exact: true })
          .click();
        await expect(password).toHaveAttribute("type", "password");
        if (mode === "signup") {
          const confirmation = page.getByLabel("Confirm password", {
            exact: true,
          });
          await expect(confirmation).toHaveAttribute(
            "autocomplete",
            "new-password",
          );
          await confirmation.fill("Draft1234");
          await page
            .getByRole("button", { name: "Show confirm password", exact: true })
            .click();
          await expect(confirmation).toHaveAttribute("type", "text");
          await expect(password).toHaveAttribute("type", "password");
          await page
            .getByRole("button", { name: "Hide confirm password", exact: true })
            .click();
          await expect(confirmation).toHaveAttribute("type", "password");
        }
        expect(requests).toEqual([]);
        expect(errors).toEqual([]);
      });
    }
  }
}

test("registration keyboard submission preserves input and prevents duplicate requests", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.getByLabel("First name", { exact: true }).fill("Ada");
  await page.getByLabel("Last name", { exact: true }).fill("Lovelace");
  await page
    .getByLabel("Email", { exact: true })
    .fill("reader@example.invalid");
  // Invalid strength is rejected by the server before Supabase is called.
  await page.getByLabel("Password", { exact: true }).fill("abcdefgh");
  await page.getByLabel("Confirm password", { exact: true }).fill("abcdefgh");
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submissions = 0;
  await page.route("**/signup", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    submissions += 1;
    await held;
    await route.continue();
  });
  await page.getByLabel("Password", { exact: true }).press("Enter");
  await expect(
    page.getByRole("button", { name: "Creating account...", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await page.keyboard.press("Enter");
  expect(submissions).toBe(1);
  release?.();
  await expect(
    page.getByText("Password must contain a number.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "reader@example.invalid",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "abcdefgh",
  );
  await expect(page.getByLabel("First name", { exact: true })).toHaveValue(
    "Ada",
  );
  await expect(page.getByLabel("Last name", { exact: true })).toHaveValue(
    "Lovelace",
  );
  await expect(
    page.getByLabel("Confirm password", { exact: true }),
  ).toHaveValue("abcdefgh");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "aria-describedby",
    "password-requirements password-error",
  );
  await expect(
    page.getByRole("button", { name: "Create account", exact: true }),
  ).toBeEnabled();
});

test("registration rejects mismatched confirmation without creating an account", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.getByLabel("First name", { exact: true }).fill("Ada");
  await page.getByLabel("Last name", { exact: true }).fill("Lovelace");
  await page
    .getByLabel("Email", { exact: true })
    .fill("reader@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("Draft1234");
  await page.getByLabel("Confirm password", { exact: true }).fill("Other1234");
  await page.getByLabel("Confirm password", { exact: true }).press("Enter");
  await expect(
    page.getByText("Passwords do not match.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Confirm password", { exact: true }),
  ).toHaveAttribute("aria-describedby", "confirmPassword-error");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "Draft1234",
  );
  await expect(
    page.getByLabel("Confirm password", { exact: true }),
  ).toHaveValue("Other1234");
});
