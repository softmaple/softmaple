/** Shared WebSocket message decoding/sizing helpers for both room objects. */
export const textFromMessage = (message: string | ArrayBuffer): string =>
  typeof message === "string" ? message : new TextDecoder().decode(message);

export const messageBytes = (message: string | ArrayBuffer): number =>
  typeof message === "string"
    ? new TextEncoder().encode(message).byteLength
    : message.byteLength;
