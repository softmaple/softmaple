"use client";

import {
  createContext,
  useContext,
  useRef,
  type FC,
  type ReactNode,
} from "react";
import {
  DEFAULT_FEATURE_FLAGS,
  type FeatureFlag,
  type FeatureFlags,
} from "@/lib/feature-flags";

const FeatureFlagsContext = createContext<FeatureFlags>(DEFAULT_FEATURE_FLAGS);

const sameFlags = (a: FeatureFlags, b: FeatureFlags): boolean =>
  (Object.keys(a) as ReadonlyArray<FeatureFlag>).every(
    (flag) => a[flag] === b[flag],
  );

/**
 * Publishes the server-resolved flag snapshot to the client tree.
 *
 * The snapshot arrives as a fresh object on every server render, so the value
 * is held by identity and only replaced when a flag actually changed. That
 * keeps consumers from re-rendering on navigation, and — more importantly —
 * means nothing downstream can mistake a new object for a new configuration.
 *
 * Flags gate *props and sibling chrome*, never the identity of the editor
 * element itself. A consumer must not write `flag ? <Editor a /> : <Editor b />`
 * or key a subtree on a flag: either would unmount the Lexical editor and its
 * collaborative replica when the flag flips. Read the flag inside the mounted
 * subtree instead.
 */
export const FeatureFlagsProvider: FC<{
  readonly children: ReactNode;
  readonly flags: FeatureFlags;
}> = ({ children, flags }) => {
  const held = useRef(flags);
  if (!sameFlags(held.current, flags)) held.current = flags;
  const value = held.current;

  return (
    <FeatureFlagsContext.Provider value={value}>
      {children}
    </FeatureFlagsContext.Provider>
  );
};

/** The whole snapshot. Prefer {@link useFeatureFlag} for a single gate. */
export const useFeatureFlags = (): FeatureFlags =>
  useContext(FeatureFlagsContext);

/** One flag, as a boolean that is stable while the flag does not change. */
export const useFeatureFlag = (flag: FeatureFlag): boolean =>
  useContext(FeatureFlagsContext)[flag];

/** Flags for a test or story, without reaching for the environment. */
export const featureFlagsForTesting = (
  overrides: Partial<FeatureFlags> = {},
): FeatureFlags => Object.freeze({ ...DEFAULT_FEATURE_FLAGS, ...overrides });
