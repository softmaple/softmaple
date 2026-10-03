import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

/** Capture a benchmark on macOS/Linux, including its descendant processes. */
export function runBenchmarkProcess(command, args, { timeout, maxBuffer }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let capturedBytes = 0;
    let error;

    const stop = (code) => {
      if (error) return;
      error = Object.assign(new Error(`spawn ${command} ${code}`), { code });
      if (!child.pid) return;
      try {
        // Native and memory workers inherit this group and must die together.
        process.kill(-child.pid, "SIGKILL");
      } catch (killError) {
        if (killError.code !== "ESRCH") error = killError;
      }
    };
    const capture = (chunks, chunk) => {
      if (error) return;
      const remaining = maxBuffer - capturedBytes;
      chunks.push(chunk.subarray(0, remaining));
      capturedBytes += Math.min(chunk.length, remaining);
      // spawnSync limits the combined stdout/stderr byte count.
      if (chunk.length > remaining) stop("ENOBUFS");
    };
    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));
    child.on("error", (cause) => {
      error ??= cause;
    });
    // Keep the deadline until pipes close, even if the group leader exits first.
    const timer = setTimeout(() => stop("ETIMEDOUT"), timeout);
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        status: error ? null : status,
        signal,
        error,
      });
    });
  });
}
