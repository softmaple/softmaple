#!/usr/bin/env node
/**
 * Bring the local Supabase stack up, down, or back to a known state.
 *
 * The containers are described by `supabase/config.toml`; the schema is
 * `prisma/migrations`, applied with `prisma migrate deploy` after the database
 * is healthy. Keeping those two steps in one script is what makes a local
 * environment reproducible: there is no second schema source to drift, and no
 * ordering for a developer to remember.
 *
 * Connection strings are the Supabase CLI's fixed local defaults on loopback.
 * They are not secrets and must never be pointed at a hosted project: the
 * script refuses to run if DIRECT_URL already names a non-loopback host.
 *
 * Usage: node scripts/local-stack.mjs <start|stop|reset|status>
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);

/** Port 54322 is `[db].port` in supabase/config.toml. */
const LOCAL_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const COMMANDS = new Set(["start", "stop", "reset", "status"]);

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const run = (command, args, extraEnv = {}) => {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(`\n${command} ${args.join(" ")} failed`);
  }
};

const assertLoopback = (value, variable) => {
  if (value === undefined || value.length === 0) return;
  let hostname;
  try {
    hostname = new URL(value).hostname;
  } catch {
    fail(`${variable} is not a valid URL`);
    return;
  }
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    fail(
      `${variable} points at ${hostname}. The local stack only ever targets ` +
        "loopback; unset it before running this script.",
    );
  }
};

const supabase = (...args) => run("supabase", args);

const migrate = () =>
  run("prisma", ["migrate", "deploy"], {
    DATABASE_URL: LOCAL_DATABASE_URL,
    DIRECT_URL: LOCAL_DATABASE_URL,
  });

const command = process.argv[2];
if (!COMMANDS.has(command)) {
  fail(`Usage: node scripts/local-stack.mjs <${[...COMMANDS].join("|")}>`);
}

assertLoopback(process.env.DIRECT_URL, "DIRECT_URL");
assertLoopback(process.env.DATABASE_URL, "DATABASE_URL");

switch (command) {
  case "start":
    supabase("start");
    migrate();
    supabase("status");
    break;
  case "stop":
    supabase("stop");
    break;
  case "reset":
    // `db reset` drops and recreates the database; migrations are disabled in
    // config.toml, so Prisma re-applies the ledger straight afterwards.
    supabase("db", "reset", "--no-seed");
    migrate();
    break;
  case "status":
    supabase("status");
    break;
  default:
    fail(`Unhandled command ${command}`);
}
