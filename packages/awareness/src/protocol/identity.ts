/**
 * Deterministic per-user presence color assignment.
 */

const PRESENCE_COLORS = ["#175bb5", "#08796f", "#943b77", "#b63f38", "#7050b4"];

export const deterministicPresenceColor = (userId: string): string => {
  const hash = [...userId].reduce(
    (value, character) => Math.imul(value, 31) + character.charCodeAt(0),
    0,
  );
  return PRESENCE_COLORS[(hash >>> 0) % PRESENCE_COLORS.length] ?? "#175bb5";
};
