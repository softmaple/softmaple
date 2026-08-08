import { describe, expect, it } from "vitest";
import {
  COLLAB_PROTOCOL_VERSION,
  ClientCollabMessageSchema,
  CollabMessageType,
  DurableAckMessageSchema,
} from "./messages";

const sampleBatch = {
  schemaVersion: 1,
  batchId: "replica:1",
  parentVersion: ["softmaple:block-model:bootstrap:event:v1"],
  events: [
    {
      schemaVersion: 1,
      id: "replica:1",
      parentVersion: ["softmaple:block-model:bootstrap:event:v1"],
      timestamp: 1,
      operation: { type: "insert", index: 1, text: "a" },
      effect: { type: "text-insert", blockId: "b1", text: "a" },
    },
  ],
};

describe("collab protocol v2", () => {
  it("parses auth as the first client message", () => {
    const parsed = ClientCollabMessageSchema.parse({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: CollabMessageType.Auth,
      accessToken: "token",
      documentId: "11111111-1111-4111-8111-111111111111",
      replicaId: "tab-1",
    });
    expect(parsed.type).toBe("auth");
  });

  it("rejects client durable-ack forgery via ClientCollabMessageSchema", () => {
    const forged = {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: CollabMessageType.DurableAck,
      documentId: "11111111-1111-4111-8111-111111111111",
      senderId: "server",
      batchIds: ["replica:1"],
    };
    expect(ClientCollabMessageSchema.safeParse(forged).success).toBe(false);
    expect(DurableAckMessageSchema.safeParse(forged).success).toBe(true);
  });

  it("parses event messages with wire batches", () => {
    const parsed = ClientCollabMessageSchema.parse({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: CollabMessageType.Event,
      documentId: "11111111-1111-4111-8111-111111111111",
      senderId: "tab-1",
      batch: sampleBatch,
    });
    expect(parsed.type).toBe("event");
  });
});
