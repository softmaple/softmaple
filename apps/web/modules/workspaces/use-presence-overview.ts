"use client";
import { useEffect, useState } from "react";
import {
  readPresenceOverview,
  type Overview,
} from "@/app/actions/documents/presence-overview";

/** Poll visible cards only; hidden pages stop all overview work. */
export function usePresenceOverview(container: HTMLElement | null) {
  const [overview, setOverview] = useState<Overview>({});
  useEffect(() => {
    if (container === null) return;
    const visible = new Set<string>();
    let stopped = false;
    let pending = false;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.getAttribute("data-presence-document");
        if (id !== null) {
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
      }
    });
    const observe = () =>
      container
        .querySelectorAll("[data-presence-document]")
        .forEach((element) => observer.observe(element));
    observe();
    const changes = new MutationObserver(observe);
    changes.observe(container, { childList: true, subtree: true });
    const refresh = async () => {
      if (
        document.visibilityState !== "visible" ||
        pending ||
        stopped ||
        visible.size === 0
      )
        return;
      pending = true;
      try {
        const ids = [...visible]
          .filter(
            (id) =>
              container.querySelector(`[data-presence-document="${id}"]`) !==
              null,
          )
          .slice(0, 24);
        const result = await readPresenceOverview(ids);
        if (!stopped)
          setOverview(
            Object.fromEntries(ids.map((id) => [id, result[id] ?? null])),
          );
      } catch {
        if (!stopped)
          setOverview(
            Object.fromEntries(
              [...visible].slice(0, 24).map((id) => [id, null]),
            ),
          );
      } finally {
        pending = false;
      }
    };
    const first = setTimeout(() => void refresh(), 500);
    const timer = setInterval(() => void refresh(), 10_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      observer.disconnect();
      changes.disconnect();
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [container]);
  return overview;
}
