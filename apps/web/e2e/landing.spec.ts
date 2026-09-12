import { expect, test } from "@playwright/test";

test("the experience lets visitors edit and reply without losing edits on replay", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("link", { name: "Explore the experience" }).click();
  await expect(page).toHaveURL(/#experience$/);
  await page.getByRole("button", { name: "Try writing" }).click();
  const paragraph = page.getByRole("textbox", { name: "Your demo paragraph" });
  await expect(paragraph).toBeFocused();
  await paragraph.fill("Our ideas become better when we write together.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByText("Our ideas become better when we write together."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Your reply to Leo" })
    .fill("Let’s make room for another perspective.");
  await page.getByRole("button", { name: "Add reply", exact: true }).click();
  await expect(
    page.getByText("Let’s make room for another perspective."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Replay collaboration demo" }).click();
  await expect(page.locator("[data-step]")).not.toHaveAttribute(
    "data-step",
    "3",
  );
  await expect(page.locator("[data-step]")).toHaveAttribute("data-step", "3", {
    timeout: 6000,
  });
  await expect(
    page.getByRole("complementary", { name: "Demo comment" }),
  ).toBeVisible({ timeout: 6000 });
  await expect(
    page.getByText("Our ideas become better when we write together."),
  ).toBeVisible();
  await expect(
    page.getByText("Let’s make room for another perspective."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("narrative comments work with the keyboard", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "write together",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#story-comment")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#story-comment")).toBeHidden();
});

test("reduced motion retains readable content and suppresses automatic animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("link", { name: "Explore the experience" }).click();
  await expect(
    page.getByRole("complementary", { name: "Demo comment" }),
  ).toBeVisible();
  const demo = page.locator("[data-step]");
  await expect(demo).toHaveAttribute("data-step", "3");
  await page.getByRole("button", { name: "Replay collaboration demo" }).click();
  await expect(demo).toHaveAttribute("data-step", "3");
  expect(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((animation) => animation.playState === "running").length,
    ),
  ).toBe(0);
  await expect(
    page.getByText("create — together.", { exact: true }),
  ).toBeVisible();
});

for (const width of [390, 768, 1440]) {
  test(`landing fits ${width}px with usable navigation and CTA`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "come together.",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const cta = page
      .getByRole("link", { name: "Start writing", exact: true })
      .filter({ visible: true })
      .first();
    await expect(cta).toHaveAttribute("href", "/signup");
    await cta.click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByLabel("Email")).toBeVisible();
  });
}
