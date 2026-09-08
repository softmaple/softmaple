/**
 * The palette, as data.
 *
 * `app/design.css` is the runtime source of truth. This mirror exists so the
 * contrast rules can be *tested*, and the test below asserts the two agree, so
 * the mirror cannot quietly drift from the stylesheet.
 */

export type ThemeName = "light" | "dark";

export type Palette = {
  readonly surfaceWorkspace: string;
  readonly surfaceDocument: string;
  readonly surfaceRaised: string;
  readonly surfaceQuiet: string;
  readonly content: string;
  readonly contentSecondary: string;
  readonly divider: string;
  readonly inputBoundary: string;
  readonly action: string;
  readonly actionContrast: string;
  readonly attentionSurface: string;
  readonly attentionContrast: string;
  readonly emphasis: string;
  readonly focus: string;
  readonly link: string;
  readonly linkHover: string;
  readonly feedbackPositive: string;
  readonly feedbackCaution: string;
  readonly feedbackCritical: string;
};

/** Maps each palette key to the CSS custom property it mirrors. */
export const PALETTE_VARIABLES: Readonly<Record<keyof Palette, string>> = {
  surfaceWorkspace: "--surface-workspace",
  surfaceDocument: "--surface-document",
  surfaceRaised: "--surface-raised",
  surfaceQuiet: "--surface-quiet",
  content: "--content",
  contentSecondary: "--content-secondary",
  divider: "--divider",
  inputBoundary: "--input-boundary",
  action: "--action",
  actionContrast: "--action-contrast",
  attentionSurface: "--attention-surface",
  attentionContrast: "--attention-contrast",
  emphasis: "--emphasis",
  focus: "--focus",
  link: "--link",
  linkHover: "--link-hover",
  feedbackPositive: "--feedback-positive",
  feedbackCaution: "--feedback-caution",
  feedbackCritical: "--feedback-critical",
};

export const PALETTE: Readonly<Record<ThemeName, Palette>> = {
  light: {
    surfaceWorkspace: "#f4f3ee",
    surfaceDocument: "#fffefa",
    surfaceRaised: "#ffffff",
    surfaceQuiet: "#eae8e1",
    content: "#191a17",
    contentSecondary: "#63645c",
    divider: "#dedcd3",
    inputBoundary: "#c9c7bc",
    action: "#ffd523",
    actionContrast: "#1f1a00",
    attentionSurface: "#fdf3cd",
    attentionContrast: "#4a3b00",
    emphasis: "#7a5a00",
    focus: "#1b57e0",
    link: "#1f4fd8",
    linkHover: "#163cae",
    feedbackPositive: "#2e6b3e",
    feedbackCaution: "#8a5a00",
    feedbackCritical: "#b3261e",
  },
  dark: {
    surfaceWorkspace: "#111315",
    surfaceDocument: "#191c1f",
    surfaceRaised: "#22262a",
    surfaceQuiet: "#1d2124",
    content: "#ecedea",
    contentSecondary: "#a2a7a5",
    divider: "#2c3135",
    inputBoundary: "#3c4247",
    action: "#ffd94a",
    actionContrast: "#1a1600",
    attentionSurface: "#2e2712",
    attentionContrast: "#ffe9a3",
    emphasis: "#ffd94a",
    focus: "#9cc0ff",
    link: "#8fb6ff",
    linkHover: "#b4cfff",
    feedbackPositive: "#7fd196",
    feedbackCaution: "#f0b44a",
    feedbackCritical: "#ff9a92",
  },
};

/** Grounds that arbitrary text and indicators may be drawn on. */
export const TEXT_GROUNDS = [
  "surfaceWorkspace",
  "surfaceDocument",
  "surfaceRaised",
  "surfaceQuiet",
] as const satisfies ReadonlyArray<keyof Palette>;
