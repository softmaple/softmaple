export const createRoomId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  }
  return Math.random().toString(36).slice(2).padEnd(12, "0").slice(0, 12);
};
