/**
 * Server-controlled redesign flags.
 *
 * Each surface of the collaboration redesign ships behind its own flag so a
 * regression in one can be rolled back without disturbing the others, and
 * without touching a single stored document. Resolution is a pure function of
 * the environment record so it is trivially testable and so the server can
 * hand one frozen snapshot to the browser per navigation.
 *
 * Flags are read once on the server and then passed down as data. They are
 * deliberately *not* read from `process.env` in client components: a value
 * that changes identity between renders would be indistinguishable from a
 * remount trigger for the editor subtree, which must stay mounted.
 */

export const FEATURE_FLAG = {
  /** New app rail, navigator, document header and context slot. */
  Shell: "shell",
  /** Named collaborators, section-relative activity, People and activity. */
  DetailedPresence: "detailedPresence",
  /** Look here, Open here, follow, and the shared-context projection. */
  SharedAttention: "sharedAttention",
  /** Field (spatial) workspace home in addition to List. */
  FieldView: "fieldView",
} as const;

export type FeatureFlag = (typeof FEATURE_FLAG)[keyof typeof FEATURE_FLAG];

export type FeatureFlags = Readonly<Record<FeatureFlag, boolean>>;

/** Environment variable that controls each flag, and its default. */
const FLAG_SOURCES: Readonly<
  Record<FeatureFlag, { readonly variable: string; readonly fallback: boolean }>
> = {
  [FEATURE_FLAG.Shell]: {
    variable: "NEXT_PUBLIC_FEATURE_SHELL",
    fallback: true,
  },
  [FEATURE_FLAG.DetailedPresence]: {
    variable: "NEXT_PUBLIC_FEATURE_DETAILED_PRESENCE",
    fallback: true,
  },
  [FEATURE_FLAG.SharedAttention]: {
    variable: "NEXT_PUBLIC_FEATURE_SHARED_ATTENTION",
    // Off by default until attention commands are fanned out by the server.
    // The contracts and the client state machine exist; the transport does
    // not, and a "Look here" that never reaches a colleague is worse than no
    // button at all.
    fallback: false,
  },
  [FEATURE_FLAG.FieldView]: {
    variable: "NEXT_PUBLIC_FEATURE_FIELD_VIEW",
    fallback: true,
  },
} as const;

const TRUTHY = new Set(["1", "true", "on", "yes", "enabled"]);
const FALSY = new Set(["0", "false", "off", "no", "disabled"]);

/**
 * Read one flag. Unset and unrecognised values fall back to the default rather
 * than failing the render: a typo in an operator's environment must not take
 * the workspace down, and the default is always the reviewed behaviour.
 */
const readFlag = (
  environment: Readonly<Record<string, string | undefined>>,
  flag: FeatureFlag,
): boolean => {
  const source = FLAG_SOURCES[flag];
  const raw = environment[source.variable]?.trim().toLowerCase();
  if (raw === undefined || raw.length === 0) return source.fallback;
  if (TRUTHY.has(raw)) return true;
  if (FALSY.has(raw)) return false;
  return source.fallback;
};

/** Every flag's default, as a frozen snapshot. */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = Object.freeze(
  Object.fromEntries(
    Object.entries(FLAG_SOURCES).map(([flag, source]) => [
      flag,
      source.fallback,
    ]),
  ) as Record<FeatureFlag, boolean>,
);

/**
 * Resolve the whole snapshot. Flags are independent by construction: one
 * variable each, no flag reads another's value.
 */
export const resolveFeatureFlags = (
  environment: Readonly<
    Record<string, string | undefined>
  > = process.env as Readonly<Record<string, string | undefined>>,
): FeatureFlags =>
  Object.freeze(
    Object.fromEntries(
      (Object.keys(FLAG_SOURCES) as ReadonlyArray<FeatureFlag>).map((flag) => [
        flag,
        readFlag(environment, flag),
      ]),
    ) as Record<FeatureFlag, boolean>,
  );

/** The environment variable that controls a flag, for docs and diagnostics. */
export const featureFlagVariable = (flag: FeatureFlag): string =>
  FLAG_SOURCES[flag].variable;
