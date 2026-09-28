import { expect, test, type Page } from "@playwright/test";

/** next/image sources carry the asset in `?url=`; plain sources are paths. */
const assetPath = (source: string) => {
  const url = new URL(source);
  return url.searchParams.get("url") ?? url.pathname;
};

function artworkRequests(page: Page) {
  const paths = new Set<string>();
  page.on("request", (request) => {
    if (request.resourceType() !== "image") return;
    // The route loading screen can paint while an auth page streams in, and
    // its CSS backgrounds reuse some artwork files. Stylesheet-initiated
    // fetches carry the stylesheet as their referrer; the artwork's <img>
    // fetches carry the page, so only those count.
    const referer = request.headers().referer;
    if (referer !== undefined && new URL(referer).pathname.endsWith(".css")) {
      return;
    }
    const path = assetPath(request.url());
    if (/paper-(login|signup)|veined-maple/.test(path)) paths.add(path);
  });
  return paths;
}

const expectedAssets = (mode: string, theme: string) =>
  [
    `/auth/paper-${mode}${theme === "dark" ? "-dark" : ""}.webp`,
    theme === "dark"
      ? "/auth/veined-maple-dark.webp"
      : "/landing/veined-maple.webp",
  ].sort();

async function expectArtwork(page: Page) {
  const images = page.locator("[data-auth-artwork] img");
  await expect(images).toHaveCount(2);
  await expect
    .poll(() =>
      images.evaluateAll((nodes) =>
        nodes.every(
          (node) =>
            node instanceof HTMLImageElement &&
            node.complete &&
            node.naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
}

/**
 * The rendered artwork is exactly the expected theme's assets, and the
 * artwork requested nothing else. A file the loading screen already fetched
 * is reused from cache without a new request, so requests may be a subset.
 */
async function expectOnlyArtwork(
  page: Page,
  requests: ReadonlySet<string>,
  expected: readonly string[],
) {
  await expectArtwork(page);
  const sources = await page
    .locator("[data-auth-artwork] img")
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        node instanceof HTMLImageElement ? node.currentSrc : "",
      ),
    );
  expect(sources.map(assetPath).sort()).toEqual(expected);
  expect([...requests].filter((path) => !expected.includes(path))).toEqual([]);
}

for (const mode of ["login", "signup"]) {
  for (const theme of ["light", "dark"] as const) {
    test(`${mode}: hidden artwork stays unloaded and only saved ${theme} assets load`, async ({
      page,
    }) => {
      const requests = artworkRequests(page);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.setViewportSize({ width: 390, height: 1100 });
      // A saved preference must win over the OS, including during hydration.
      await page.emulateMedia({
        colorScheme: theme === "dark" ? "light" : "dark",
      });
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme,
      );
      await page.goto(`/${mode}`);
      await page
        .getByRole("button", { name: "Show password", exact: true })
        .click();
      await expect(
        page.getByLabel("Password", { exact: true }),
      ).toHaveAttribute("type", "text");
      await expect(page.locator("[data-auth-artwork] img")).toHaveCount(0);
      expect([...requests]).toEqual([]);
      await page.setViewportSize({ width: 899, height: 1100 });
      await expect(page.locator("[data-auth-artwork] img")).toHaveCount(0);
      expect([...requests]).toEqual([]);
      await page.setViewportSize({ width: 900, height: 1100 });
      await expectOnlyArtwork(page, requests, expectedAssets(mode, theme));
      await expect(
        page.locator('[data-auth-artwork] img[loading="lazy"]'),
      ).toHaveCount(2);
      expect(errors).toEqual([]);
    });
  }
}

test("artwork follows system theme changes and defers hidden-theme requests", async ({
  page,
}) => {
  const requests = artworkRequests(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/signup");
  await expectOnlyArtwork(page, requests, expectedAssets("signup", "light"));
  await page.setViewportSize({ width: 390, height: 1100 });
  await expect(page.locator("[data-auth-artwork] img")).toHaveCount(0);
  requests.clear();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect([...requests]).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await expectOnlyArtwork(page, requests, expectedAssets("signup", "dark"));
  await page.emulateMedia({ colorScheme: "light" });
  await expect(
    page.locator('[data-auth-artwork] img[src="/auth/paper-signup.webp"]'),
  ).toBeVisible();
  await expectArtwork(page);
});
