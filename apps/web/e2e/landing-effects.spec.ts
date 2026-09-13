import { expect, test } from "@playwright/test";

for (const width of [390, 768, 1440]) {
  test(`brush precedes finite paper light at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({
      reducedMotion: "no-preference",
      colorScheme: "light",
    });
    await page.addInitScript(() =>
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      }),
    );
    await page.goto("/");
    await expect(page.locator("#hero-title")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // Measure brush stability after the intentional copy entrance has finished.
    await page.locator("#hero-title").evaluate(async (heading) => {
      await Promise.all(
        (heading.parentElement?.getAnimations() ?? []).map(
          (animation) => animation.finished,
        ),
      );
    });
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const brush = page.locator("[data-brush]");
    const glow = page.locator("[data-glow]");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Good ideascome together.",
    );
    await expect(brush).toHaveAttribute("data-brush", "waiting");
    const titleBox = await page.locator("#hero-title").boundingBox();
    await page.waitForTimeout(150);
    await expect(brush).toHaveAttribute("data-brush", "waiting");
    await page.waitForTimeout(450);
    await expect(brush).toHaveAttribute("data-brush", "painting");
    const halfway = await brush.evaluate((el) => getComputedStyle(el).clipPath);
    expect(halfway).not.toBe("none");
    await expect(glow).toHaveAttribute("data-glow", "waiting");
    // Leaving the viewport pauses the reveal, including across long absences.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(150);
    const paused = await brush.evaluate((el) => getComputedStyle(el).clipPath);
    await page.waitForTimeout(750);
    expect(await brush.evaluate((el) => getComputedStyle(el).clipPath)).toBe(
      paused,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(brush).toHaveAttribute("data-brush", "complete");
    await expect(glow).toHaveAttribute("data-glow", "illuminating");
    await page.waitForTimeout(900);
    const peak = await glow.evaluate((el) =>
      (el as HTMLCanvasElement).toDataURL(),
    );
    await expect(glow).toHaveAttribute("data-glow", "settled");
    const final = await glow.evaluate((el) =>
      (el as HTMLCanvasElement).toDataURL(),
    );
    expect(peak).not.toBe(final);
    await page.waitForTimeout(500);
    expect(
      await glow.evaluate((el) => (el as HTMLCanvasElement).toDataURL()),
    ).toBe(final);
    expect(await page.locator("#hero-title").boundingBox()).toEqual(titleBox);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await expect(brush).toHaveAttribute("data-brush", "complete");
    await expect(glow).toHaveAttribute("data-glow", "settled");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("reduced motion paints the final brush and static light", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("[data-brush]")).toHaveCSS("clip-path", "none");
  await expect(page.locator("[data-glow]")).toHaveAttribute(
    "data-glow",
    "settled",
  );
  const before = await page
    .locator("canvas")
    .evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(500);
  expect(
    await page
      .locator("canvas")
      .evaluate((el) => (el as HTMLCanvasElement).toDataURL()),
  ).toBe(before);
});

for (const failure of ["unavailable", "throws", "lost"] as const) {
  test(`WebGL ${failure} preserves the hero and CTA`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (failure !== "lost") {
      await page.addInitScript((mode) => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          ...args: Parameters<typeof original>
        ) {
          if (String(args[0]).startsWith("webgl")) {
            if (mode === "throws") throw new Error("WebGL blocked");
            return null;
          }
          return original.apply(this, args);
        } as typeof original;
      }, failure);
    }
    await page.goto("/");
    if (failure === "lost") {
      await expect(page.locator("[data-glow]")).toHaveAttribute(
        "data-glow",
        "settled",
      );
      await page.locator("canvas").evaluate((el) => {
        (el as HTMLCanvasElement)
          .getContext("webgl")
          ?.getExtension("WEBGL_lose_context")
          ?.loseContext();
      });
    }
    await expect(page.locator("[data-glow]")).toHaveAttribute(
      "data-glow",
      "fallback",
    );
    await expect(page.locator('img[src*="paper-ribbon"]')).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Start writing", exact: true }).first(),
    ).toHaveAttribute("href", "/signup");
  });
}

test("without JavaScript the streamed landing remains readable", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(process.env.E2E_BASE_URL ?? "http://127.0.0.1:32110");
  await expect(page.locator("#hero-title")).toBeVisible();
  await expect(page.locator('img[src*="paper-ribbon"]')).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Start writing", exact: true }).first(),
  ).toHaveAttribute("href", "/signup");
  await context.close();
});
