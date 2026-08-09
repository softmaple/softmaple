import { describe, expect, it } from "vitest";
import {
  COLLAB_ACCESS_MODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  LEGACY_COLLAB_PROTOCOL_VERSION,
  parseClientCollabMessage,
  parseServerCollabMessage,
} from "./index";

describe("collaboration v3 authentication", () => {
  it("parses access-token and public credentials", () => {
    expect(
      parseClientCollabMessage({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Auth,
        credential: { kind: "public" },
        documentId: "document-id",
        sessionId: "session-id",
      }),
    ).toMatchObject({ credential: { kind: "public" } });
    expect(
      parseClientCollabMessage({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Auth,
        credential: { kind: "access-token", token: "token" },
        documentId: "document-id",
        sessionId: "session-id",
      }),
    ).toMatchObject({ credential: { kind: "access-token", token: "token" } });
  });

  it("accepts a legacy signed-in authentication message", () => {
    expect(
      parseClientCollabMessage({
        protocolVersion: LEGACY_COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Auth,
        accessToken: "token",
        documentId: "document-id",
        sessionId: "session-id",
      }),
    ).toMatchObject({ accessToken: "token" });
  });

  it("requires null identity and read-only access for public ready messages", () => {
    expect(
      parseServerCollabMessage({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Ready,
        accessMode: COLLAB_ACCESS_MODE.Public,
        documentId: "document-id",
        userId: null,
        role: null,
        canWrite: false,
      }),
    ).toMatchObject({ accessMode: COLLAB_ACCESS_MODE.Public });
    expect(() =>
      parseServerCollabMessage({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Ready,
        accessMode: COLLAB_ACCESS_MODE.Public,
        documentId: "document-id",
        userId: null,
        role: null,
        canWrite: true,
      }),
    ).toThrow("invalid ready message");
  });
});
