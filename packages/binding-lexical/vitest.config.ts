import { configDefaults, defineConfig } from "vitest/config";

const SMALL_STACK_TESTS = "src/**/*.small-stack.test.ts";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
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
