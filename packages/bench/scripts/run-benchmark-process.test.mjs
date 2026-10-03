import { Buffer } from "node:buffer";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { runBenchmarkProcess } from "./run-benchmark-process.mjs";

const options = { timeout: 2_000, maxBuffer: 1024 };
const run = (source) =>
  runBenchmarkProcess(process.execPath, ["-e", source], options);

describe("benchmark process capture", () => {
  it.each([0, 7])("preserves UTF-8 output and exit status %i", async (status) => {
    const result = await run(`
      process.stdout.write("你好🙂");
      process.stderr.write("BENCH_MAX_RSS_KIB=123\\n");
      process.exitCode = ${status};
    `);
    expect(result).toEqual({
      stdout: "你好🙂",
      stderr: "BENCH_MAX_RSS_KIB=123\n",
      status,
      signal: null,
      error: undefined,
    });
  });

  it("returns launch errors without hanging", async () => {
    const result = await runBenchmarkProcess(
      "/nonexistent/benchmark-node",
      [],
      options,
    );
    expect(result.status).toBeNull();
    expect(result.error.code).toBe("ENOENT");
  });

  it("bounds combined stdout and stderr in bytes", async () => {
    const result = await run(`
      process.stdout.write("a".repeat(800), () => {
        process.stderr.write("b".repeat(800));
        setInterval(() => {}, 1000);
      });
    `);
    expect(result.status).toBeNull();
    expect(result.signal).toBe("SIGKILL");
    expect(result.error.code).toBe("ENOBUFS");
    expect(Buffer.byteLength(result.stdout + result.stderr)).toBe(1024);
  });

  it.each([false, true])(
    "kills descendants on timeout even when the leader exits first: %s",
    async (exitLeader) => {
      const descendant = `
        process.stdout.write(String(process.pid));
        setTimeout(() => { process.stderr.write("SURVIVED"); }, 4000);
      `;
      const result = await run(`
        const { spawn } = require("node:child_process");
        const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], {
          stdio: ["ignore", "inherit", "inherit"],
        });
        ${exitLeader ? "child.unref();" : ""}
      `);
      expect(result.error.code).toBe("ETIMEDOUT");
      expect(result.status).toBeNull();
      expect(result.signal).toBe(exitLeader ? null : "SIGKILL");
      expect(result.stderr).toBe("");
      // Its inherited pipes must close before it can emit SURVIVED.
      expect(Number(result.stdout)).toBeGreaterThan(0);
    },
    10_000,
  );
});
