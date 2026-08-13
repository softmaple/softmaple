import { afterEach, describe, expect, it, vi } from "vitest";
import { logError, logMetric } from "../src/constants";

describe("logMetric", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the event as a JSON line via console.log", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logMetric({
      type: "event-appended",
      batchCount: 1,
      documentId: "doc-1",
      durationMs: 12,
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({
      type: "event-appended",
      batchCount: 1,
      documentId: "doc-1",
      durationMs: 12,
      message: "Cloudflare collaboration metric",
    });
  });
});

describe("logError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the error as a JSON line via console.error", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    logError(new Error("boom"), { documentId: "doc-1", messageType: "event" });

    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(error.mock.calls[0]?.[0] as string)).toMatchObject({
      documentId: "doc-1",
      messageType: "event",
      error: "boom",
      errorName: "Error",
      message: "Cloudflare collaboration request failed",
    });
  });
});
