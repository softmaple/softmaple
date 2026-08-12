/**
 * Deterministic per-user presence color assignment.
 */

const PRESENCE_COLORS = ["#e11d48", "#0f766e", "#c2410c", "#7c3aed", "#0369a1"];

export const deterministicPresenceColor = (userId: string): string => {
  const hash = [...userId].reduce(
    (value, character) => Math.imul(value, 31) + character.charCodeAt(0),
    0,
  );
  return PRESENCE_COLORS[(hash >>> 0) % PRESENCE_COLORS.length] ?? "#e11d48";
};
