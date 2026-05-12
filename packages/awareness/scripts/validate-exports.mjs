import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptsDir, "..");
const packageJsonPath = path.resolve(packageRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const getExportTargets = (value) => {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") {
    return Object.values(value).filter((target) => typeof target === "string");
  }
  return [];
};

const missingTargets = Object.values(packageJson.exports)
  .flatMap(getExportTargets)
  .filter((target) => target.startsWith("./dist/"))
  .filter((target) => !existsSync(path.resolve(packageRoot, target)));

if (missingTargets.length > 0) {
  console.error("Package exports point at missing build outputs:");
  for (const target of missingTargets) {
    console.error(`- ${target}`);
  }
  process.exit(1);
}
