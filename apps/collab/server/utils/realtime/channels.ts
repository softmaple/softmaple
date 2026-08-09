import type { SupportedCollabProtocolVersion } from "@softmaple/collab-protocol";

export const documentRealtimeChannel = (
  documentId: string,
  protocolVersion: SupportedCollabProtocolVersion,
): string => `softmaple:collab:document:v${protocolVersion}:${documentId}`;

export const presenceRealtimeChannel = (roomId: string): string =>
  `softmaple:collab:presence:v2:${roomId}`;

export const documentLeaseScope = (documentId: string): string =>
  `document:${documentId}`;

export const presenceLeaseScope = (roomId: string): string =>
  `presence:${roomId}`;
