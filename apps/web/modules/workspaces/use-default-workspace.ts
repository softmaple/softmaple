"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHANGE_EVENT = "softmaple:default-workspace-change";
const serverSnapshot = () => undefined;

/** Store only a workspace ID, scoped to the signed-in account and schema version. */
export function useDefaultWorkspace(userId: string) {
  const key = `softmaple:default-workspace:v1:${userId}`;
  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }, [key]);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) onChange();
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener(CHANGE_EVENT, onChange);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(CHANGE_EVENT, onChange);
      };
    },
    [key],
  );
  const workspaceId = useSyncExternalStore(
    subscribe,
    getSnapshot,
    serverSnapshot,
  );
  const setDefaultWorkspace = useCallback(
    (id: number | null) => {
      const value = id === null ? null : String(id);
      try {
        if (window.localStorage.getItem(key) === value) return;
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
        window.dispatchEvent(new Event(CHANGE_EVENT));
      } catch {
        // Storage can be disabled or full; workspace navigation still works.
      }
    },
    [key],
  );

  return {
    workspaceId,
    isReady: workspaceId !== undefined,
    setDefaultWorkspace,
  };
}
