"use client";

import { useSyncExternalStore } from "react";

export type CollaborationPreferences = {
  readonly focusMode: boolean;
  readonly shareLocation: boolean;
  readonly reducedMotion: boolean;
};
const defaults: CollaborationPreferences = Object.freeze({
  focusMode: false,
  shareLocation: true,
  reducedMotion: false,
});
const key = "softmaple:collaboration-preferences:v1";
const eventName = "softmaple:preferences";
let cachedRaw: string | null | undefined;
let cached = defaults;

const snapshot = (): CollaborationPreferences => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    const value: unknown = raw === null ? null : JSON.parse(raw);
    const object = typeof value === "object" && value !== null ? value : {};
    cached = {
      focusMode: "focusMode" in object && object.focusMode === true,
      shareLocation: !(
        "shareLocation" in object && object.shareLocation === false
      ),
      reducedMotion: "reducedMotion" in object && object.reducedMotion === true,
    };
  } catch {
    cached = defaults;
  }
  return cached;
};
const subscribe = (notify: () => void) => {
  window.addEventListener(eventName, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(eventName, notify);
    window.removeEventListener("storage", notify);
  };
};
export const useCollaborationPreferences = () =>
  useSyncExternalStore(subscribe, snapshot, () => defaults);

export const updateCollaborationPreferences = (
  patch: Partial<CollaborationPreferences>,
): boolean => {
  try {
    localStorage.setItem(key, JSON.stringify({ ...snapshot(), ...patch }));
    window.dispatchEvent(new Event(eventName));
    return true;
  } catch {
    return false;
  }
};
