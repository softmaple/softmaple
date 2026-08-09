export const requirePresenceConnectionId = (user: unknown): string => {
  if (
    typeof user !== "object" ||
    user === null ||
    typeof (user as { connectionId?: unknown }).connectionId !== "string" ||
    (user as { connectionId: string }).connectionId.length === 0
  ) {
    throw new Error("Presence user requires a connectionId");
  }
  return (user as { connectionId: string }).connectionId;
};

export const presenceUserIdFromUnknown = (user: unknown): string =>
  typeof user === "object" &&
  user !== null &&
  typeof (user as { userId?: unknown }).userId === "string" &&
  (user as { userId: string }).userId.length > 0
    ? (user as { userId: string }).userId
    : "unknown";
