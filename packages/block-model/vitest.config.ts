import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const SMALL_STACK_TESTS = "src/**/*.small-stack.test.ts";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@softmaple/eg-walker/anchors",
        replacement: fileURLToPath(
          new URL("../eg-walker/src/anchors.ts", import.meta.url),
        ),
      },
      {
        find: "@softmaple/eg-walker",
        replacement: fileURLToPath(
          new URL("../eg-walker/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          exclude: [...configDefaults.exclude, SMALL_STACK_TESTS],
        },
      },
      {
        extends: true,
        test: {
          // A 128 KiB stack caps one call at 16,384 arguments, so these tests
          // can exceed what a spread passes with far fewer batches than the
          // default stack's ~125,000. Worker threads reject V8 flags such as
          // --stack-size, so the project needs forked processes.
          name: "small-stack",
          include: [SMALL_STACK_TESTS],
          pool: "forks",
          execArgv: ["--stack-size=128"],
        },
      },
    ],
  },
});
