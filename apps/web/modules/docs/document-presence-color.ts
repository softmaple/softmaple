import { deterministicPresenceColor } from "@softmaple/awareness/protocol";

/** Wire identity uses a portable color. The UI pairs its hue across themes. */
export const documentPresenceColor = deterministicPresenceColor;
export const documentPresenceThemeColor = (userId: string): string => {
  const color = documentPresenceColor(userId);
  const roles: Readonly<Record<string, string>> = {
    "#175bb5": "blue",
    "#08796f": "teal",
    "#943b77": "plum",
    "#b63f38": "coral",
    "#7050b4": "violet",
  };
  return `var(--person-${roles[color] ?? "blue"}, ${color})`;
};
