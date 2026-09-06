/** Emit the child's own peak RSS, including failures that call process.exit(). */
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [entry, ...args] = process.argv.slice(2);
if (!entry) throw new Error("Missing benchmark entry");
process.argv = [process.execPath, resolve(entry), ...args];
process.on("exit", () => {
  process.stderr.write(`BENCH_MAX_RSS_KIB=${process.resourceUsage().maxRSS}\n`);
});
await import(pathToFileURL(resolve(entry)).href);
