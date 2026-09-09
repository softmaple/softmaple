/** Reproducible local review artifacts; credentials stay in the ignored directory. */
/* global document, localStorage, innerWidth */
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createBlockReplica } from "@softmaple/block-model";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = `${root}.artifacts/redesign`;
const env = JSON.parse(fs.readFileSync(`${output}/local-env.json`, "utf8"));
const origin = env.E2E_BASE_URL;
if (env.E2E_ALLOW_LOCAL_SEED !== "true" || new URL(origin).hostname !== "127.0.0.1" || new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "127.0.0.1") throw new Error("Prepare a loopback environment with local-e2e.mjs --prepare first.");
const command = process.argv[2];
const run = (executable, args, overrides = {}) => spawn(executable, args, { cwd: root, env: { ...env, ...overrides }, stdio: "inherit" });
if (command === "serve" || command === "serve-production") {
  const production = command === "serve-production";
  const children = [
    run("pnpm", ["--filter", "@softmaple/web", production ? "start" : "dev", "--port", "32112"]),
    production ? run("node", ["apps/collab-nitro/.output/server/index.mjs"], { PORT: "32111", HOST: "127.0.0.1" }) : run("pnpm", ["--filter", "@softmaple/collab-nitro", "exec", "nitro", "dev", "--port", "32111"]),
    run("node", ["apps/web/scripts/e2e-collab-router.mjs"]),
  ];
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { children.forEach((child) => child.kill(signal)); process.exit(); });
} else if (command === "build" || command === "test") {
  const args = command === "build" ? ["--filter", "@softmaple/web", "build"] : ["--filter", "@softmaple/web", "test:e2e", "--reporter=line", `--output=${output}/e2e-results`, ...process.argv.slice(3)];
  const child = run("pnpm", args, command === "build" ? { NODE_ENV: "production" } : {});
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
} else if (command === "seed") {
  const response = await fetch(`${origin}/api/e2e/seed`, { method: "POST", headers: { Authorization: `Bearer ${env.E2E_SEED_SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "seed", runId: `review-${Date.now()}`, documentCount: 31 }) });
  if (!response.ok) throw new Error(`Local review seed failed (${response.status}); use the development review server.`);
  const seed = await response.json();
  fs.writeFileSync(`${output}/seed.json`, JSON.stringify(seed), { mode: 0o600 });
  const checked = (result) => { if (result.error) throw new Error(result.error.message); return result.data; };
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  checked(await admin.from("workspaces").update({ title: "Fieldwork studio", description: "Ideas become clearer when we work on them together." }).eq("id", seed.workspace.id));
  checked(await admin.from("workspaces").update({ title: "New ideas" }).eq("id", seed.ownerOnlyWorkspace.id));
  checked(await admin.from("documents").update({ title: "A shared understanding", is_public: true }).eq("id", seed.document.id));
  const documents = checked(await admin.from("documents").select("id").eq("workspace_id", seed.workspace.id).neq("id", seed.document.id).order("created_at", { ascending: false }).limit(8));
  const titles = ["Research questions", "Field notes · Kyoto", "Workshop playbook", "Design principles", "中文研究笔记", "Interview synthesis", "Open questions", "A room for possibility"];
  for (let index = 0; index < documents.length; index += 1) checked(await admin.from("documents").update({ title: titles[index] }).eq("id", documents[index].id));
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = checked(await client.auth.signInWithPassword(seed.owner));
  const replica = createBlockReplica(`review-${Date.now()}`);
  const batch = replica.transact((transaction) => transaction.replaceDocument({ blocks: [
    { type: "h1", text: "A shared understanding" },
    { type: "paragraph", text: "Good work needs room to think. Great work gives us a way to bring those thoughts together, without losing our own place." },
    { type: "h2", text: "Start with what we notice" },
    { type: "paragraph", text: "We are exploring how small moments of shared attention can change the way a team writes. Keep the evidence close to the argument. Make space for a second reading." },
    { type: "quote", text: "The strongest ideas emerge when we can see the same page from a different perspective." },
    { type: "h2", text: "An invitation, not an interruption" },
    { type: "paragraph", text: "Select a passage and invite a collaborator to look here. They choose when to open it. Your writing stays where you left it, and returning is always one action away." },
    { type: "h2", text: "Make room for every voice" },
    { type: "paragraph", text: "共同编辑，让想法更清晰。 一緒に考え、それぞれの場所に戻る。 We can work in different languages and still share the same context." },
    { type: "h2", text: "What we will try next" },
    { type: "paragraph", text: "Test the invitation with a real writing partner. Notice what feels clear, what asks too much attention, and what helps you get back to your own work." },
  ] }));
  const persisted = await fetch(`${origin}/collab/document-events`, { method: "POST", headers: { Authorization: `Bearer ${auth.session.access_token}`, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ documentId: seed.document.id, batches: [batch] }) });
  if (!persisted.ok) throw new Error(`Review content failed to persist (${persisted.status})`);
  console.log("Created isolated review accounts and 31 documents.");
} else if (command === "capture") {
  const seed = JSON.parse(fs.readFileSync(`${output}/seed.json`, "utf8"));
  const directory = `${output}/milestone-routes`;
  fs.mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("Email").fill(seed.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(seed.owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
  await context.storageState({ path: `${output}/owner-state.json` });
  fs.chmodSync(`${output}/owner-state.json`, 0o600);
  const results = [];
  const capture = async (name, path, target = page) => {
    await target.goto(path);
    await target.waitForLoadState("networkidle");
    for (const [device, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]]) {
      for (const theme of ["light", "dark"]) {
        await target.setViewportSize(viewport);
        await target.evaluate((theme) => { localStorage.setItem("theme", theme); document.documentElement.classList.toggle("dark", theme === "dark"); document.documentElement.classList.toggle("light", theme === "light"); }, theme);
        await target.waitForTimeout(350);
        await target.screenshot({ path: `${directory}/${name}-${device}-${theme}.png`, animations: "disabled" });
        results.push({ name, path, device, theme, overflow: await target.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1) });
      }
    }
    console.log(`Captured ${name}`);
  };
  const workspace = `/workspace/${seed.workspace.slug}`;
  for (const [name, path] of [["dashboard", "/dashboard"], ["home", workspace], ["editor", `${workspace}/doc/${seed.document.slug}`], ["new-document", `${workspace}/doc/new`], ["workspace-settings", `${workspace}/settings`], ["members", `${workspace}/settings?tab=members`], ["account", "/settings/account"], ["empty-workspace", `/workspace/${seed.ownerOnlyWorkspace.slug}`], ["public-reader", `/share/${seed.document.slug}`], ["not-found", "/missing-redesign-page"]]) await capture(name, path);
  const anonymous = await browser.newContext({ baseURL: origin, reducedMotion: "reduce" });
  const publicPage = await anonymous.newPage();
  for (const [name, path] of [["landing", "/"], ["login", "/login"], ["signup", "/signup"], ["reset-password", "/reset-password"], ["update-password", "/reset-password/update"]]) await capture(name, path, publicPage);
  for (const width of [1024, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${workspace}/doc/${seed.document.slug}`);
    await page.waitForLoadState("networkidle");
    if (width === 320) {
      const clipped = await page.locator("header button, [role=tab]").evaluateAll((controls) => controls.flatMap((control) => {
        const rect = control.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return [];
        return rect.left < 0 || rect.right > innerWidth + 1 || rect.height < 44
          ? [control.getAttribute("aria-label") ?? control.textContent?.trim()]
          : [];
      }));
      if (clipped.length > 0) throw new Error(`Compact controls are clipped or below 44 px: ${clipped.join(", ")}`);
    }
    await page.screenshot({ path: `${directory}/editor-${width}.png`, animations: "disabled" });
    results.push({ name: "editor", width, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await page.screenshot({ path: `${directory}/editor-200-percent.png`, animations: "disabled" });
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  await page.emulateMedia({ forcedColors: "active" });
  await page.screenshot({ path: `${directory}/editor-forced-colors.png`, animations: "disabled" });
  fs.writeFileSync(`${directory}/checks.json`, JSON.stringify({ results, errors, zoomMethod: "CSS zoom 200%; browser chrome zoom not automated" }, null, 2));
  await browser.close();
} else {
  throw new Error("Use serve, serve-production, build, test, seed, or capture.");
}
