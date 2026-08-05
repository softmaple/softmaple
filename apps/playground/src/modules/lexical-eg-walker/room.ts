export const createRoomId = (): string => {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
};

export const resolveRoomId = (
  requestedRoom: string | undefined,
  generatedRoom: string,
): string => requestedRoom ?? generatedRoom;
