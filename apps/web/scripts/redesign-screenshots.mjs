/**
 * Capture redesign screenshots against a running server.
 *
 * Usage: node scripts/redesign-screenshots.mjs <route> [route...]
 * Writes to docs/design/assets/redesign, one file per route/viewport/theme.
 */
import { chromium } from "@playwright/test";

const OUT = "/home/user/softmaple/docs/design/assets/redesign";
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];
const ROUTES = process.argv.slice(2);

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
for (const viewport of VIEWPORTS) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: theme,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    for (const route of ROUTES) {
      const slug = route === "/" ? "landing" : route.replace(/^\//, "").replace(/\//g, "-");
      await page.goto(`http://127.0.0.1:3000${route}`, {
        waitUntil: "networkidle",
      });
      // next-themes runs with `defaultTheme="system"`, so the context's
      // colorScheme is what selects the theme; nothing is injected here.
      await page.waitForTimeout(250);
      const file = `${OUT}/${slug}--${viewport.name}-${theme}.png`;
      await page.screenshot({ path: file });
      console.log(file);
    }
    await context.close();
  }
}
await browser.close();
