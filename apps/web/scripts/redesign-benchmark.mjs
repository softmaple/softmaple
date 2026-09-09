/** Explicitly local, independent-session benchmark. Never targets a remote project. */
/* global window, document, requestAnimationFrame */
import fs from "node:fs";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { COLLAB_PROTOCOL_VERSION } from "@softmaple/collab-protocol";
import { createBlockReplica } from "@softmaple/block-model";
import { PRESENCE_CAPABILITIES, PRESENCE_PROTOCOL_VERSION } from "@softmaple/awareness/protocol";

const envPath = process.argv[2];
if (!envPath) throw new Error("First argument must identify a private local environment JSON file.");
const env = JSON.parse(fs.readFileSync(envPath, "utf8"));
const origin = env.E2E_BASE_URL ?? "http://127.0.0.1:32110";
for (const address of [origin, env.NEXT_PUBLIC_SUPABASE_URL]) {
  const url = new URL(address);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Benchmark requires loopback HTTP services.");
}
if (env.E2E_ALLOW_LOCAL_SEED !== "true") throw new Error("Local seeding must be explicitly enabled.");
const words = Number(process.argv[3] ?? 10_000);
const count = Number(process.argv[4] ?? 2);
const viewers = process.argv.includes("--viewers");
if (![10_000, 50_000].includes(words) || !(viewers ? count === 100 : [2, 10, 25].includes(count))) throw new Error("Unsupported reference fixture.");
const output = fileURLToPath(new URL("../../../.artifacts/redesign/performance", import.meta.url));
fs.mkdirSync(output, { recursive: true });
const reportPath = `${output}/${words}-${count}-${viewers ? "viewers" : "editors"}.json`;
const report = { fixtureWords: words, sessions: count, scenario: viewers ? "transport-only authenticated viewers" : "independent rendered editors", hardware: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 2 ** 30), node: process.version }, websocketDelayMsPerDirection: viewers ? 0 : 40, delayMethod: "Browser-native message delivery queue, 40 ms each direction; network jitter not emulated", baseline: "No pre-redesign timing baseline available", status: "running", stages: [] };
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const log = (stage) => { report.stages.push({ stage, at: new Date().toISOString() }); save(); console.log(stage); };
const checked = (result) => { if (result.error) throw new Error(result.error.message); return result.data; };
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const run = `bench-${randomBytes(5).toString("hex")}`;
const password = `Bench-${randomBytes(16).toString("hex")}9a`;
const users = [];
let workspaceId;
let browser;
const start = Date.now();
const timeout = setTimeout(() => { report.status = "timeout"; save(); console.error("Benchmark exceeded 12 minutes; partial results retained."); process.exit(2); }, 720_000);
try {
  log("Creating isolated accounts");
  // Viewer capacity includes a separate owner who does not join the room.
  for (let index = 0; index < count + (viewers ? 1 : 0); index += 1) {
    const email = `${run}-${index}@softmaple.invalid`;
    const user = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Benchmark ${index}` } })).user;
    users.push({ id: user.id, email });
  }
  const workspace = checked(await admin.from("workspaces").insert({ owner_id: users[0].id, slug: run, title: "Local performance fixture" }).select("id").single());
  workspaceId = workspace.id;
  checked(await admin.from("workspace_members").insert(users.slice(1).map((user) => ({ workspace_id: workspaceId, user_id: user.id, role: viewers ? "VIEWER" : "EDITOR", invited_by: users[0].id }))));
  const doc = checked(await admin.from("documents").insert({ workspace_id: workspaceId, author_id: users[0].id, slug: run, title: `${words.toLocaleString()} word reference`, is_public: true }).select("id").single());
  const auth = [];
  for (const user of users) {
    let cookies = [];
    const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll: (next) => { cookies = next; } } });
    const session = checked(await client.auth.signInWithPassword({ email: user.email, password })).session;
    auth.push({ userId: user.id, token: session.access_token, cookies: cookies.map(({ name, value }) => ({ name, value, url: origin })) });
  }
  log("Building mixed-content durable fixture");
  const vocabulary = ["shared", "attention", "research", "writing", "together", "明确", "collaboration", "戻る", "evidence", "review"];
  const blocks = Array.from({ length: words / 100 }, (_, index) => ({ type: index % 10 === 0 ? "h2" : index % 10 === 4 ? "quote" : "paragraph", text: Array.from({ length: 100 }, (_, word) => vocabulary[(index + word) % vocabulary.length]).join(" ") }));
  const fixtureStarted = performance.now();
  const fixturePath = `${output}/fixture-${words}.json`;
  let batch;
  if (fs.existsSync(fixturePath)) {
    batch = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    report.fixtureCached = true;
  } else {
    const replica = createBlockReplica(run);
    batch = replica.transact((transaction) => transaction.replaceDocument({ blocks }));
    fs.writeFileSync(fixturePath, JSON.stringify(batch));
  }
  report.fixtureConstructionMs = Math.round(performance.now() - fixtureStarted);
  const response = await fetch(`${origin}/collab/document-events`, { method: "POST", headers: { Authorization: `Bearer ${auth[0].token}`, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ documentId: doc.id, batches: [batch] }) });
  if (!response.ok) throw new Error(`Fixture persistence failed: ${response.status}`);
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  const url = `/workspace/${run}/doc/${run}`;
  if (viewers) {
    const page = await browser.newPage();
    await page.goto(`${origin}/login`);
    const joined = await page.evaluate(async ({ sessions, roomId, capabilities, version, documentVersion }) => {
      const started = performance.now();
      const sockets = [];
      const presenceResults = Promise.all(sessions.map((session, index) => new Promise((resolve) => {
        const socket = new WebSocket(`${location.origin.replace("http", "ws")}/collab/presence?roomId=${roomId}`);
        sockets.push(socket);
        const senderId = `capacity-${index}`;
        const frame = (type, payload) => socket.send(JSON.stringify({ type, roomId, senderId, timestamp: Date.now(), payload }));
        const timer = setTimeout(() => resolve("timeout"), 20_000);
        socket.onopen = () => frame("auth", { connectionId: senderId, token: session.token, userId: session.userId, protocolVersion: version, capabilities });
        socket.onmessage = ({ data }) => {
          const message = JSON.parse(data);
          if (message.type === "auth_ok") {
            frame("join", { user: { id: senderId, name: `Viewer ${index + 1}`, color: "#175bb5", status: "active", lastActiveAt: Date.now() } });
            frame("presence:sync", {});
          }
          if (message.type === "presence:sync-response") { clearTimeout(timer); resolve("joined"); }
          if (message.type === "auth_error" || message.type === "error") { clearTimeout(timer); resolve(message.type); }
        };
        socket.onclose = () => { clearTimeout(timer); resolve("closed"); };
      })));
      const documentResults = Promise.all(sessions.map((session, index) => new Promise((resolve) => {
        const socket = new WebSocket(`${location.origin.replace("http", "ws")}/collab/document`);
        sockets.push(socket);
        const timer = setTimeout(() => resolve("timeout"), 30_000);
        const send = (message) => socket.send(JSON.stringify({ protocolVersion: documentVersion, ...message }));
        const repair = (afterCursor = "0") => send({ type: "repair-request", requestId: `capacity-${index}`, afterCursor });
        socket.onopen = () => send({ type: "auth", documentId: roomId, sessionId: `viewer-${index}`, credential: { kind: "access-token", token: session.token } });
        socket.onmessage = ({ data }) => {
          const message = JSON.parse(data);
          if (message.type === "ready") {
            if (message.canWrite) { clearTimeout(timer); resolve("unexpected-write-access"); }
            else repair();
          }
          if (message.type === "repair-response") {
            if (message.complete) { clearTimeout(timer); resolve("read-ready"); }
            else repair(message.nextCursor);
          }
          if (message.type === "error") { clearTimeout(timer); resolve(message.code); }
        };
        socket.onclose = () => { clearTimeout(timer); resolve("closed"); };
      })));
      const [outcomes, documents] = await Promise.all([presenceResults, documentResults]);
      const elapsedMs = performance.now() - started;
      sockets.forEach((socket) => socket.close());
      return { elapsedMs, outcomes, documents };
    }, { sessions: auth.slice(1), roomId: doc.id, capabilities: PRESENCE_CAPABILITIES, version: PRESENCE_PROTOCOL_VERSION, documentVersion: COLLAB_PROTOCOL_VERSION });
    report.capacity = { joined: joined.outcomes.filter((value) => value === "joined").length, elapsedMs: Math.round(joined.elapsedMs), failures: joined.outcomes.filter((value) => value !== "joined") };
    report.capacity.documentsRead = joined.documents.filter((value) => value === "read-ready").length;
    report.capacity.documentFailures = joined.documents.filter((value) => value !== "read-ready");
    report.status = report.capacity.joined === count && report.capacity.documentsRead === count ? "passed" : "failed";
  } else {
    log("Opening independent editors with controlled 80 ms WebSocket RTT");
    const pages = [];
    for (const session of auth) {
      const context = await browser.newContext({ baseURL: origin,
        extraHTTPHeaders: { Origin: origin }, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
      await context.addCookies(session.cookies);
      await context.addInitScript(() => {
        // Delay browser-native frames so authentication and Origin stay real.
        const NativeWebSocket = window.WebSocket;
        window.WebSocket = class extends NativeWebSocket {
          constructor(url, protocols) {
            super(url, protocols);
            this.delayed = new WeakSet();
            super.addEventListener("message", (event) => {
              if (this.delayed.has(event)) return;
              event.stopImmediatePropagation();
              setTimeout(() => {
                if (this.readyState !== NativeWebSocket.OPEN) return;
                const delivery = new MessageEvent("message", { data: event.data, origin: event.origin });
                this.delayed.add(delivery);
                this.dispatchEvent(delivery);
              }, 40);
            }, { capture: true });
          }
          send(data) {
            setTimeout(() => {
              if (this.readyState === NativeWebSocket.OPEN) super.send(data);
            }, 40);
          }
        };
        window.benchmark = { inputs: [], longTasks: [], geometry: [], markers: {} };
        new PerformanceObserver((list) => window.benchmark.geometry.push(...list.getEntries().filter((entry) => entry.name === "softmaple.presence.geometry").map((entry) => entry.duration))).observe({ type: "measure" });
        new PerformanceObserver((list) => window.benchmark.longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: "longtask", buffered: true });
        document.addEventListener("beforeinput", () => { const start = performance.now(); requestAnimationFrame(() => window.benchmark.inputs.push(performance.now() - start)); }, true);
      });
      const page = await context.newPage();
      page.setDefaultTimeout(45_000);
      await page.goto(url);
      const editor = page.getByRole("textbox", { name: "Rich text editor", exact: true });
      await editor.waitFor();
      await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent?.includes("research"));
      await editor.locator("p").nth(pages.length).click();
      await page.keyboard.press("End");
      await page.evaluate(() => { window.benchmark.inputs = []; window.benchmark.longTasks = []; });
      pages.push(page);
      log(`Editor ${pages.length}/${count} ready`);
    }
    report.openAllEditorsMs = Date.now() - start;
    const convergence = [];
    for (let round = 0; round < 8; round += 1) {
      const before = performance.now();
      const markers = pages.map((_, index) => `probe${round}user${index}end`);
      await Promise.all(pages.map((page, index) => page.keyboard.insertText(markers[index])));
      await Promise.all(pages.map((page) => page.waitForFunction((markers) => markers.every((marker) => document.querySelector('[contenteditable="true"]')?.textContent?.includes(marker)), markers, { timeout: 45_000 })));
      convergence.push(performance.now() - before);
      log(`Concurrent round ${round + 1}/8 converged`);
    }
    const measurements = await Promise.all(pages.map((page) => page.evaluate(() => window.benchmark)));
    const percentile = (values, percentile) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * percentile) - 1] ?? null;
    const inputs = measurements.flatMap((measurement) => measurement.inputs);
    const longTasks = measurements.flatMap((measurement) => measurement.longTasks);
    const geometry = measurements.flatMap((measurement) => measurement.geometry);
    report.measurements = { inputSamples: inputs.length, inputToNextFrameP95Ms: percentile(inputs, .95), concurrentRoundConvergenceP95Ms: percentile(convergence, .95), longTasks: longTasks.length, longestTaskMs: Math.max(0, ...longTasks), geometrySamples: geometry.length, geometryP95Ms: percentile(geometry, .95), overlayCost: "Geometry calculation only; excludes React commit and paint", remoteCaretDisplay: "Not measured; convergence is a separate document metric" };
    report.status = report.measurements.inputToNextFrameP95Ms < 50 ? "passed-input-target" : "failed-input-target";
    await pages[0].screenshot({ path: `${output}/${words}-${count}-editors.png` });
  }
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  save();
  await browser?.close();
  if (workspaceId) checked(await admin.from("workspaces").delete().eq("id", workspaceId));
  for (const user of users) {
    await admin.auth.admin.deleteUser(user.id);
    await admin.from("users").delete().eq("id", user.id);
  }
  clearTimeout(timeout);
  if (!report.status.startsWith("passed")) process.exitCode = 1;
  log(`Finished: ${report.status}`);
}
