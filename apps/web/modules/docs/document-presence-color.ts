/** Stable across tabs and clients, so the roster and document use one identity. */
export const documentPresenceColor = (userId: string): string => {
  const palette = [
    "#2563eb",
    "#7c3aed",
    "#0f766e",
    "#be185d",
    "#a16207",
    "#c2410c",
  ];
  const hash = Array.from(userId).reduce(
    (value, character) =>
      (Math.imul(value, 31) + (character.codePointAt(0) ?? 0)) >>> 0,
    0,
  );
  return palette[hash % palette.length] ?? "#2563eb";
};
