import { PALETTE, type ThemeName } from "@/lib/design/palette";

/**
 * Collaborator identity colours.
 *
 * Three rules, all of them load-bearing:
 *
 * 1. **No yellow.** Yellow is the action colour. A caret in yellow reads as a
 *    button, and a person is not an affordance.
 * 2. **Paired per theme.** A colour that carries a caret against warm paper is
 *    not the same colour that carries it against charcoal. One value cannot do
 *    both jobs, so each identity has two.
 * 3. **Stable per account.** The same person is the same colour in the roster,
 *    at their caret and on their selection — across tabs, reloads and clients.
 */

export type CollaboratorColor = {
  /** Caret, selection tint and roster dot. */
  readonly color: string;
  /** Text drawn *on* that colour, e.g. a name label. */
  readonly onColor: string;
};

/** Six identities, deliberately far apart in hue and none of them yellow. */
export const COLLABORATOR_PALETTE: Readonly<
  Record<ThemeName, ReadonlyArray<CollaboratorColor>>
> = {
  light: [
    { color: "#1d4ed8", onColor: "#ffffff" },
    { color: "#6d28d9", onColor: "#ffffff" },
    { color: "#0f766e", onColor: "#ffffff" },
    { color: "#be185d", onColor: "#ffffff" },
    { color: "#0e7490", onColor: "#ffffff" },
    { color: "#c2410c", onColor: "#ffffff" },
  ],
  dark: [
    { color: "#7fb0ff", onColor: "#0b1220" },
    { color: "#c4a5ff", onColor: "#160b28" },
    { color: "#5fd8c8", onColor: "#04211d" },
    { color: "#ff93be", onColor: "#2b0716" },
    { color: "#5fc7e8", onColor: "#04202b" },
    { color: "#ffa57a", onColor: "#2b1104" },
  ],
};

/** Stable slot for an account, independent of theme. */
export const collaboratorColorIndex = (userId: string): number => {
  const hash = Array.from(userId).reduce(
    (value, character) =>
      (Math.imul(value, 31) + (character.codePointAt(0) ?? 0)) >>> 0,
    0,
  );
  return hash % COLLABORATOR_PALETTE.light.length;
};

/** The pair for an account in one theme. */
export const collaboratorColor = (
  userId: string,
  theme: ThemeName,
): CollaboratorColor => {
  const entry = COLLABORATOR_PALETTE[theme][collaboratorColorIndex(userId)];
  // Index is derived modulo the palette length, so this is unreachable; it
  // exists so a future palette edit fails loudly rather than rendering black.
  if (entry === undefined) {
    throw new Error(`No collaborator colour for "${userId}" in ${theme}`);
  }
  return entry;
};

/**
 * Stable across tabs and clients, so the roster and document use one identity.
 *
 * Presence colour travels over the wire to other clients, which may be in the
 * other theme, so the *light* value is what is published and each client is
 * free to render its own paired value locally.
 */
export const documentPresenceColor = (userId: string): string =>
  collaboratorColor(userId, "light").color;

/** Never assigned to a person: these belong to actions and to status. */
export const RESERVED_COLORS = [
  PALETTE.light.action,
  PALETTE.dark.action,
] as const;
