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
    // Wait for hydration and the completed entrance. Native transforms can
    // serialize their final identity as a matrix instead of the keyword none.
    await expect(page.locator(".landing-copy")).toHaveAttribute(
      "data-hero-entrance",
      "complete",
    );
    await expect(page.locator(".landing-copy")).toHaveCSS("opacity", "1");
    expect(
      await page
        .locator(".landing-copy")
        .evaluate(
          (el) =>
            new DOMMatrixReadOnly(getComputedStyle(el).transform).isIdentity,
        ),
    ).toBe(true);
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
  await expect(page.locator("[data-brush]")).toHaveCSS("clip-path", "none");
  await context.close();
});

test("desktop unfold preserves transforms and resets for reduced motion and mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  // The static server-rendered note already has its resting rotation. Wait
  // for hydration before programmatic scrolling, which Next can restore.
  await expect(page.locator(".landing-art")).toHaveAttribute(
    "data-hero-entrance",
    "complete",
  );
  const artwork = page.locator("canvas").locator("..");
  const note = page
    .getByRole("heading", { name: "A brighter tomorrow" })
    .locator("..");
  const transform = () =>
    note.evaluate((el) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return {
        y: matrix.m42,
        rotate: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
      };
    });
  await expect.poll(async () => (await transform()).rotate).toBeCloseTo(12, 1);
  await page
    .locator("#product")
    .evaluate((el) => window.scrollTo(0, el.clientHeight * 0.75));
  await expect(artwork).toHaveCSS("opacity", "0.75");
  await expect(artwork).toHaveCSS("will-change", "transform, opacity");
  await expect.poll(async () => (await transform()).y).toBeCloseTo(-24, 1);
  await expect.poll(async () => (await transform()).rotate).toBeCloseTo(2, 1);
  await expect(note.locator(":scope > span").first()).toHaveCSS(
    "opacity",
    "0.9",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(artwork).toHaveCSS("opacity", "1");
  await expect(artwork).toHaveCSS("will-change", "auto");
  await expect.poll(async () => (await transform()).y).toBe(0);
  await expect.poll(async () => (await transform()).rotate).toBeCloseTo(12, 1);
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(artwork).toHaveCSS("opacity", "1");
  await expect(artwork).toHaveCSS("will-change", "auto");
  await expect.poll(async () => (await transform()).y).toBe(0);
});

test("changing reduced motion during the brush settles the effect without replay", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator("[data-brush]")).toHaveAttribute(
    "data-brush",
    "painting",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-brush]")).toHaveAttribute(
    "data-brush",
    "complete",
  );
  await expect(page.locator("[data-glow]")).toHaveAttribute(
    "data-glow",
    "settled",
  );
  const glow = await page
    .locator("canvas")
    .evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(500);
  await expect(page.locator("[data-brush]")).toHaveCSS("clip-path", "none");
  expect(
    await page
      .locator("canvas")
      .evaluate((el) => (el as HTMLCanvasElement).toDataURL()),
  ).toBe(glow);
});
