/**
 * Capture redesign screenshots against a running server.
 *
 * Usage: node scripts/redesign-screenshots.mjs <route> [route...]
 * Writes to docs/design/assets/redesign, one file per route/viewport/theme.
 */
import { chromium } from "@playwright/test";

const OUT = "/home/user/softmaple/docs/design/assets/redesign";
/**
 * The two review viewports, plus the three responsive checks: the tablet
 * breakpoint where the navigator collapses, the narrowest supported width, and
 * 200% zoom (emulated as half the CSS viewport at twice the scale, which is
 * what a browser zoom actually does to layout).
 */
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000, scale: 1 },
  { name: "mobile", width: 390, height: 844, scale: 1 },
  { name: "tablet-1024", width: 1024, height: 900, scale: 1 },
  { name: "narrow-320", width: 320, height: 800, scale: 1 },
  { name: "zoom-200", width: 720, height: 500, scale: 2 },
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
      deviceScaleFactor: viewport.scale,
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
