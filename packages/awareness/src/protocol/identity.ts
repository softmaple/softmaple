/**
 * Deterministic per-user presence color assignment.
 */

export const deterministicPresenceColor = (userId: string): string => {
  const colors = ["#e11d48", "#0f766e", "#c2410c", "#7c3aed", "#0369a1"];
  const hash = [...userId].reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  return colors[hash % colors.length] ?? colors[0] ?? "#e11d48";
};
