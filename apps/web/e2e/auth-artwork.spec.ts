import { expect, test, type Page } from "@playwright/test";

function artworkRequests(page: Page) {
  const paths = new Set<string>();
  page.on("request", (request) => {
    if (request.resourceType() !== "image") return;
    const url = new URL(request.url());
    const path = url.searchParams.get("url") ?? url.pathname;
    if (/paper-(login|signup)|veined-maple/.test(path)) paths.add(path);
  });
  return paths;
}

const expectedAssets = (mode: string, theme: string) => [
  `/auth/paper-${mode}${theme === "dark" ? "-dark" : ""}.webp`,
  theme === "dark"
    ? "/auth/veined-maple-dark.webp"
    : "/landing/veined-maple.webp",
];

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
      await expectArtwork(page);
      expect([...requests].sort()).toEqual(expectedAssets(mode, theme).sort());
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
  await expectArtwork(page);
  expect([...requests].sort()).toEqual(
    expectedAssets("signup", "light").sort(),
  );
  await page.setViewportSize({ width: 390, height: 1100 });
  await expect(page.locator("[data-auth-artwork] img")).toHaveCount(0);
  requests.clear();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect([...requests]).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await expectArtwork(page);
  expect([...requests].sort()).toEqual(expectedAssets("signup", "dark").sort());
  await page.emulateMedia({ colorScheme: "light" });
  await expect(
    page.locator('[data-auth-artwork] img[src="/auth/paper-signup.webp"]'),
  ).toBeVisible();
  await expectArtwork(page);
});
