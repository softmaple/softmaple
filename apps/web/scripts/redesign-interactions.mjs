/** Local review: real addressed attention and automated accessibility evidence. */
/* global document, localStorage, window */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = `${root}.artifacts/redesign`;
const env = JSON.parse(fs.readFileSync(`${output}/local-env.json`, "utf8"));
const seed = JSON.parse(fs.readFileSync(`${output}/seed.json`, "utf8"));
const origin = env.E2E_BASE_URL;
if (env.E2E_ALLOW_LOCAL_SEED !== "true" || new URL(origin).hostname !== "127.0.0.1") {
  throw new Error("Use the explicitly enabled local review environment.");
}
const browser = await chromium.launch({ headless: true });
const workspace = `/workspace/${seed.workspace.slug}`;
const documentUrl = `${workspace}/doc/${seed.document.slug}`;
const contexts = [];
const login = async (credentials) => {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
  return page;
};
const appearance = async (page, width, height, theme) => {
  await page.setViewportSize({ width, height });
  await page.evaluate((theme) => {
    localStorage.setItem("theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
  }, theme);
  // Theme changes can transition inherited text and backgrounds independently.
  // Audit the settled state, as the screenshot capture does.
  await page.waitForTimeout(350);
};
try {
  if (process.argv[2] === "attention") {
    const directory = `${output}/milestone-attention`;
    fs.mkdirSync(directory, { recursive: true });
    const owner = await login(seed.owner);
    const receiver = await login(seed.editor);
    await owner.goto(documentUrl);
    await receiver.goto(documentUrl);
    const writing = owner.getByRole("textbox", { name: "Rich text editor" });
    await writing.click();
    await owner.keyboard.press("ControlOrMeta+Home");
    await owner.getByRole("button", { name: "People and activity" }).click();
    await owner.getByRole("checkbox", { name: /E2E Editor/ }).check();
    await owner.getByRole("button", { name: "Present my place", exact: true }).click();
    const checks = [];
    for (const [device, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
      for (const theme of ["light", "dark"]) {
        await appearance(receiver, width, height, theme);
        const editor = receiver.getByRole("textbox", { name: "Rich text editor" });
        await editor.click();
        await receiver.keyboard.press("ControlOrMeta+End");
        const previous = await editor.evaluate(() => ({ offset: window.getSelection()?.focusOffset, text: window.getSelection()?.toString() }));
        await owner.getByRole("button", { name: "Look here", exact: true }).click();
        await expect(receiver.getByRole("button", { name: "Open here", exact: true })).toBeVisible();
        await expect(editor).toBeFocused();
        expect(await editor.evaluate(() => ({ offset: window.getSelection()?.focusOffset, text: window.getSelection()?.toString() }))).toEqual(previous);
        await receiver.screenshot({ path: `${directory}/invitation-${device}-${theme}.png` });
        await receiver.getByRole("button", { name: "Open here", exact: true }).click();
        await expect(receiver.getByRole("textbox", { name: "Shared context, read only" })).toHaveAttribute("contenteditable", "false");
        await receiver.getByRole("button", { name: "Follow presenter", exact: true }).click();
        await expect(receiver.getByText("Following E2E Owner", { exact: true })).toBeVisible();
        await receiver.screenshot({ path: `${directory}/following-${device}-${theme}.png` });
        await receiver.getByRole("button", { name: "Return to my place", exact: true }).click();
        await expect(receiver.getByRole("textbox", { name: "Shared context, read only" })).toHaveCount(0);
        checks.push({ device, theme, focusPreserved: true, selectionPreserved: true, returned: true });
        await receiver.screenshot({ path: `${directory}/returned-${device}-${theme}.png` });
        // Respect the server's five-second invitation rate limit.
        await receiver.waitForTimeout(5100);
      }
    }
    fs.writeFileSync(`${directory}/checks.json`, JSON.stringify({ independentAuthenticatedSessions: 2, simulatedCrowd: false, checks }, null, 2));
  } else if (process.argv[2] === "accessibility") {
    const page = await login(seed.owner);
    const anonymous = await browser.newContext({ baseURL: origin });
    contexts.push(anonymous);
    const publicPage = await anonymous.newPage();
    const axePath = fs.globSync(`${root}node_modules/.pnpm/axe-core@*/node_modules/axe-core/axe.min.js`)[0];
    if (!axePath) throw new Error("Installed axe-core is required.");
    const results = [];
    for (const [name, path, target] of [
      ["dashboard", "/dashboard", page], ["home", workspace, page], ["editor", documentUrl, page],
      ["settings", `${workspace}/settings`, page], ["members", `${workspace}/settings?tab=members`, page],
      ["account", "/settings/account", page], ["new-document", `${workspace}/doc/new`, page],
      ["empty", `/workspace/${seed.ownerOnlyWorkspace.slug}`, page], ["share", `/share/${seed.document.slug}`, publicPage],
      ["landing", "/", publicPage], ["login", "/login", publicPage], ["signup", "/signup", publicPage],
      ["reset", "/reset-password", publicPage], ["update-password", "/reset-password/update", publicPage], ["not-found", "/missing-redesign-page", publicPage],
    ]) {
      await target.goto(path);
      await target.waitForLoadState("networkidle");
      await target.addScriptTag({ path: axePath });
      for (const [device, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
        for (const theme of ["light", "dark"]) {
          await appearance(target, width, height, theme);
          const audit = await target.evaluate(async () => {
            const result = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } });
            return { violations: result.violations, incomplete: result.incomplete.map(({ id, nodes }) => ({ id, count: nodes.length })) };
          });
          results.push({ name, device, theme, ...audit });
        }
      }
      console.log(`Audited ${name}`);
    }
    fs.writeFileSync(`${output}/accessibility.json`, JSON.stringify(results, null, 2));
    console.log(`${results.length} route/theme/viewport audits; ${results.reduce((count, result) => count + result.violations.length, 0)} violations.`);
  } else {
    throw new Error("Use attention or accessibility.");
  }
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
