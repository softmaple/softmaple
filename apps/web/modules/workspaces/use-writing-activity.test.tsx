import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWritingActivity } from "./use-writing-activity";
import {
  WRITING_ACTIVITY_REFRESH_MS,
  type WritingActivitySnapshot,
} from "./writing-activity";

const snapshot = (...titles: string[]): WritingActivitySnapshot => ({
  documents: titles.map((title) => ({
    id: title,
    lastWrittenAt: "2026-09-27T10:00:00.000Z",
    slug: title.toLowerCase(),
    title,
    writers: [
      {
        avatarSrc: null,
        fullName: "Mia",
        isViewer: false,
        lastWrittenAt: "2026-09-27T10:00:00.000Z",
        userId: "mia",
      },
    ],
  })),
  observedAt: "2026-09-27T10:00:30.000Z",
});

function Probe({
  enabled,
  initial,
}: {
  readonly enabled?: boolean;
  readonly initial: WritingActivitySnapshot | null;
}) {
  const activity = useWritingActivity(7, initial, { enabled });
  return (
    <output>
      {activity === null
        ? "unavailable"
        : activity.documents.map((document) => document.title).join(",") ||
          "quiet"}
    </output>
  );
}

const fetchMock = vi.fn<typeof fetch>();
let visibility: DocumentVisibilityState = "visible";
let container: HTMLDivElement;
let root: Root;

const shown = () => container.querySelector("output")?.textContent;
const respond = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status,
    }),
  );
const render = (initial: WritingActivitySnapshot | null, enabled = true) =>
  act(() => root.render(<Probe enabled={enabled} initial={initial} />));
const elapse = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const setVisibility = (next: DocumentVisibilityState) =>
  act(async () => {
    visibility = next;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useWritingActivity", () => {
  it("starts from the server snapshot and refreshes while visible", async () => {
    render(snapshot("Draft"));
    expect(shown()).toBe("Draft");
    expect(fetchMock).not.toHaveBeenCalled();

    respond(snapshot("Draft", "Notes"));
    await elapse(WRITING_ACTIVITY_REFRESH_MS);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/7/activity",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(shown()).toBe("Draft,Notes");
  });

  it("pauses in a hidden tab and catches up when it returns", async () => {
    render(snapshot("Draft"));
    await setVisibility("hidden");
    await elapse(WRITING_ACTIVITY_REFRESH_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();

    respond(snapshot());
    await setVisibility("visible");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(shown()).toBe("quiet");
  });

  it("waits for a tab opened in the background to become visible", async () => {
    visibility = "hidden";
    render(snapshot("Draft"));
    await elapse(WRITING_ACTIVITY_REFRESH_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();

    respond(snapshot("Notes"));
    await setVisibility("visible");
    expect(shown()).toBe("Notes");
  });

  it("does not reschedule a refresh cancelled by hiding the tab", async () => {
    fetchMock.mockImplementationOnce(
      (_, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    render(snapshot("Draft"));
    await elapse(WRITING_ACTIVITY_REFRESH_MS);
    await setVisibility("hidden");
    await elapse(WRITING_ACTIVITY_REFRESH_MS * 3);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(shown()).toBe("Draft");
  });

  it("keeps the last snapshot through failed or malformed replies", async () => {
    render(snapshot("Draft"));
    respond({ code: "INTERNAL", message: "Down" }, 500);
    await elapse(WRITING_ACTIVITY_REFRESH_MS);
    expect(shown()).toBe("Draft");

    respond({ documents: "nope" });
    await elapse(WRITING_ACTIVITY_REFRESH_MS);
    expect(shown()).toBe("Draft");

    respond(snapshot("Notes"));
    await elapse(WRITING_ACTIVITY_REFRESH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(shown()).toBe("Notes");
  });

  it("clears activity and stops once access is lost", async () => {
    render(snapshot("Draft"));
    respond({ code: "FORBIDDEN", message: "No" }, 403);
    await elapse(WRITING_ACTIVITY_REFRESH_MS);
    expect(shown()).toBe("unavailable");

    await elapse(WRITING_ACTIVITY_REFRESH_MS * 3);
    await setVisibility("hidden");
    await setVisibility("visible");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never polls when disabled", async () => {
    render(snapshot("Preview"), false);
    await elapse(WRITING_ACTIVITY_REFRESH_MS * 3);
    await setVisibility("hidden");
    await setVisibility("visible");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(shown()).toBe("Preview");
  });

  it("adopts a newer server snapshot over a polled one", async () => {
    render(snapshot("Draft"));
    respond(snapshot("Polled"));
    await elapse(WRITING_ACTIVITY_REFRESH_MS);
    expect(shown()).toBe("Polled");

    render(snapshot("Rendered"));
    expect(shown()).toBe("Rendered");
  });

  it("aborts an unfinished refresh on unmount", async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    });
    render(snapshot("Draft"));
    await elapse(WRITING_ACTIVITY_REFRESH_MS);
    expect(signal?.aborted).toBe(false);

    act(() => root.unmount());
    root = createRoot(container);
    expect(signal?.aborted).toBe(true);
  });
});
