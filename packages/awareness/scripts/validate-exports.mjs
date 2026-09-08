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

/*
 * The published stylesheet must only carry `awareness-*` rules. Re-adding
 * `@import "tailwindcss/utilities"` to `src/global.css` would ship every class
 * name Tailwind scans out of this package (`.hidden`, `.flex`, …) to consumer
 * apps, where it lands after their own Tailwind output and overrides their
 * responsive variants on source order.
 */
const classSelector = /(?:^|[\s,>+~(])\.((?:\\.|[A-Za-z_-])(?:\\.|[\w-])*)/g;

const stylesheet = readFileSync(
  path.resolve(packageRoot, "dist/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const foreignClasses = [
  ...new Set(
    Array.from(
      stylesheet.matchAll(classSelector),
      (match) => match[1],
    ).filter((className) => !className.startsWith("awareness-")),
  ),
];

if (foreignClasses.length > 0) {
  console.error(
    "dist/styles.css leaks non-awareness classes into consumer apps:",
  );
  for (const className of foreignClasses) {
    console.error(`- .${className}`);
  }
  process.exit(1);
}
