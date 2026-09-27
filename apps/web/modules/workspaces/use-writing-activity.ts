"use client";

import { useEffect, useState } from "react";
import {
  WRITING_ACTIVITY_REFRESH_MS,
  writingActivitySnapshotSchema,
  type WritingActivitySnapshot,
} from "./writing-activity";

/** Statuses after which this viewer cannot read the workspace's activity. */
const ACCESS_LOST_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

type ActivityResponse =
  | { readonly kind: "snapshot"; readonly snapshot: WritingActivitySnapshot }
  | { readonly kind: "access-lost" };

export const fetchWritingActivity = async (
  workspaceId: number,
  signal: AbortSignal,
): Promise<ActivityResponse> => {
  const response = await fetch(`/api/workspaces/${workspaceId}/activity`, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (ACCESS_LOST_STATUSES.has(response.status)) return { kind: "access-lost" };
  if (!response.ok) {
    throw new Error(
      `Workspace ${workspaceId} activity request failed (${response.status})`,
    );
  }
  return {
    kind: "snapshot",
    snapshot: writingActivitySnapshotSchema.parse(await response.json()),
  };
};

/**
 * Keeps the server-rendered writing activity current while the home is
 * visible: a refresh every interval, and at once when the tab returns. A
 * failed refresh keeps the last snapshot for the next attempt; losing access
 * clears it and stops polling. `null` means activity is unavailable.
 */
export const useWritingActivity = (
  workspaceId: number,
  initial: WritingActivitySnapshot | null,
  { enabled = true }: { readonly enabled?: boolean } = {},
): WritingActivitySnapshot | null => {
  const [state, setState] = useState({ initial, snapshot: initial });
  // A new server render (navigation or router refresh) supersedes polling.
  const current =
    state.initial === initial ? state : { initial, snapshot: initial };
  if (current !== state) setState(current);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: AbortController | undefined;

    const schedule = (): void => {
      clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") {
        timer = setTimeout(() => void refresh(), WRITING_ACTIVITY_REFRESH_MS);
      }
    };

    const refresh = async (): Promise<void> => {
      inFlight?.abort();
      const request = new AbortController();
      inFlight = request;
      try {
        const result = await fetchWritingActivity(workspaceId, request.signal);
        if (request.signal.aborted) return;
        if (result.kind === "access-lost") {
          stopped = true;
          setState((previous) => ({ ...previous, snapshot: null }));
          return;
        }
        setState((previous) => ({ ...previous, snapshot: result.snapshot }));
      } catch {
        // Offline, a deploy, or a malformed reply: keep the last snapshot and
        // let the next scheduled refresh try again.
      } finally {
        if (inFlight === request) {
          inFlight = undefined;
          schedule();
        }
      }
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        if (!stopped) void refresh();
        return;
      }
      clearTimeout(timer);
      inFlight?.abort();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimeout(timer);
      inFlight?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, workspaceId]);

  return current.snapshot;
};
