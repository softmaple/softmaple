/** Run real browser tests against a loopback-only Supabase stack. */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const run = (args, options = {}) => execFileSync("pnpm", args, {
  cwd: root, stdio: "inherit", ...options,
});
const local = (value) => {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Local E2E refused a non-loopback service");
  }
  return value;
};

if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
  if (process.platform !== "darwin") throw new Error("Start Docker before running local E2E.");
  execFileSync("open", ["-a", "Docker"]);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
if (spawnSync("docker", ["network", "inspect", "softmaple-local"], { stdio: "ignore" }).status !== 0) {
  execFileSync("docker", ["network", "create", "-o", "com.docker.network.bridge.host_binding_ipv4=127.0.0.1", "softmaple-local"], { stdio: "ignore" });
}

run(["--filter", "@softmaple/db", "exec", "supabase", "start",
  "--network-id", "softmaple-local", "--exclude",
  "studio,postgres-meta,imgproxy,edge-runtime,logflare,vector,supavisor,realtime"],
  { stdio: ["ignore", "pipe", "inherit"] });
const status = JSON.parse(run([
  "--filter", "@softmaple/db", "exec", "supabase", "status", "-o", "json",
], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" }));
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: local(status.API_URL),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
  SUPABASE_URL: local(status.API_URL),
  SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  DIRECT_URL: local(status.DB_URL),
  DATABASE_URL: local(status.DB_URL),
  E2E_ALLOW_LOCAL_SEED: "true",
  E2E_ALLOW_REMOTE_SEED: "false",
  E2E_SEED_SECRET: randomBytes(32).toString("hex"),
  COLLAB_REALTIME_DRIVER: "memory",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:32110",
  E2E_BASE_URL: "http://127.0.0.1:32110",
  COLLAB_ALLOWED_ORIGINS: "http://127.0.0.1:32110",
  E2E_GATEWAY_PORT: "32110",
  E2E_NEXT_ORIGIN: "http://127.0.0.1:32112",
  E2E_COLLAB_ORIGIN: "http://127.0.0.1:32111",
};
run(["--filter", "@softmaple/db", "db:deploy"], { env });
run(["--filter", "@softmaple/db", "exec", "prisma", "db", "execute", "--file",
  "supabase/scripts/local-test-grants.sql"], { env });
if (process.argv.includes("--prepare")) {
  const output = `${root}.artifacts/redesign`;
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${output}/local-env.json`, JSON.stringify(env), { mode: 0o600 });
  console.log(`Local review environment prepared in ${output}`);
  process.exit(0);
}
const child = spawn("pnpm", ["--filter", "@softmaple/web", "test:e2e", ...process.argv.slice(2)], {
  cwd: root, stdio: "inherit", env,
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
