"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FC,
  type ReactNode,
} from "react";

/**
 * Local, per-device workspace preferences.
 *
 * These are deliberately *not* account settings synced to the server: they
 * describe how this machine should behave, and a person on a small laptop
 * should not have their choice pushed onto their desktop. Theme stays with
 * `next-themes`; everything here is what the redesign added.
 */

export const MOTION_PREFERENCE = {
  System: "system",
  Reduced: "reduced",
  Full: "full",
} as const;

export type MotionPreference =
  (typeof MOTION_PREFERENCE)[keyof typeof MOTION_PREFERENCE];

export type Preferences = {
  /** Overrides the OS setting in either direction; `system` defers to it. */
  readonly motion: MotionPreference;
  /**
   * Quiet the peripheral chrome while writing. It hides *incoming noise*, not
   * the person: collaborators still see this session, its caret and its
   * activity exactly as before. Anything else would be a lie to the room.
   */
  readonly focusMode: boolean;
  /**
   * Publish a section-level location ("in Method") rather than only presence.
   * Off means collaborators still see that this person is here and active.
   */
  readonly detailedLocation: boolean;
};

export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  motion: MOTION_PREFERENCE.System,
  focusMode: false,
  detailedLocation: true,
});

const STORAGE_KEY = "softmaple.preferences.v1";

const isMotionPreference = (value: unknown): value is MotionPreference =>
  value === MOTION_PREFERENCE.System ||
  value === MOTION_PREFERENCE.Reduced ||
  value === MOTION_PREFERENCE.Full;

/** Parse stored JSON defensively; a corrupt value must not break the app. */
export const parsePreferences = (raw: string | null): Preferences => {
  if (raw === null) return DEFAULT_PREFERENCES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return DEFAULT_PREFERENCES;
  }
  const record = parsed as Record<string, unknown>;
  return Object.freeze({
    motion: isMotionPreference(record.motion)
      ? record.motion
      : DEFAULT_PREFERENCES.motion,
    focusMode:
      typeof record.focusMode === "boolean"
        ? record.focusMode
        : DEFAULT_PREFERENCES.focusMode,
    detailedLocation:
      typeof record.detailedLocation === "boolean"
        ? record.detailedLocation
        : DEFAULT_PREFERENCES.detailedLocation,
  });
};

type PreferencesContextValue = {
  readonly preferences: Preferences;
  readonly setPreference: <TKey extends keyof Preferences>(
    key: TKey,
    value: Preferences[TKey],
  ) => void;
};

const PreferencesContext = createContext<PreferencesContextValue>({
  preferences: DEFAULT_PREFERENCES,
  setPreference: () => undefined,
});

/**
 * Reflect the motion preference onto the document element so CSS — which
 * cannot read React state — can honour it. `system` removes the attribute
 * entirely so the `prefers-reduced-motion` media query is the only rule left.
 */
const applyMotionAttribute = (motion: MotionPreference): void => {
  const root = document.documentElement;
  if (motion === MOTION_PREFERENCE.System) {
    root.removeAttribute("data-motion");
    return;
  }
  root.setAttribute("data-motion", motion);
};

export const PreferencesProvider: FC<{ readonly children: ReactNode }> = ({
  children,
}) => {
  // Server and first client render must agree, so start from the defaults and
  // adopt storage in an effect rather than during render.
  const [preferences, setPreferences] =
    useState<Preferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private browsing or blocked storage: defaults are a valid answer.
    }
    setPreferences(parsePreferences(stored));
  }, []);

  useEffect(() => {
    applyMotionAttribute(preferences.motion);
  }, [preferences.motion]);

  const setPreference = useCallback(
    <TKey extends keyof Preferences>(key: TKey, value: Preferences[TKey]) => {
      setPreferences((current) => {
        const next = Object.freeze({ ...current, [key]: value });
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Preference is still applied for this session.
        }
        return next;
      });
    },
    [],
  );

  const value = useMemo(
    () => ({ preferences, setPreference }),
    [preferences, setPreference],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
};

export const usePreferences = (): PreferencesContextValue =>
  useContext(PreferencesContext);
