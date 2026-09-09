import { describe, expect, it } from "vitest";
import {
  PRESENCE_CAPABILITIES,
  PRESENCE_PROTOCOL_VERSION,
} from "@softmaple/awareness/protocol";
import { PRESENCE_FRAME } from "@softmaple/collab-runtime";
import { awarenessPresenceCodec as codec } from "../server/adapters/awareness-presence-codec";

const auth = (userId: string, sessionId?: string) =>
  codec.parseAuth({
    token: "test-token",
    userId,
    connectionId: `connection-${userId}`,
    protocolVersion: PRESENCE_PROTOCOL_VERSION,
    capabilities: PRESENCE_CAPABILITIES,
    ...(sessionId === undefined
      ? {}
      : { extensions: { sharedAttention: 1, sessionId } }),
  });

describe("shared attention codec compatibility", () => {
  it("binds tab identity to the authenticated user and preserves legacy auth", () => {
    expect(auth("owner").protocolContext).toBeUndefined();
    expect(auth("owner", "tab").protocolContext).toEqual({
      sharedAttention: 1,
      sessionId: "owner:tab",
    });
    expect(auth("other", "owner:tab").protocolContext).toEqual({
      sharedAttention: 1,
      sessionId: "other:owner:tab",
    });
  });
  it("filters recipient-only invitations out of old and unaddressed views", () => {
    const context = auth("owner", "tab").protocolContext;
    const receiverContext = auth("reader", "tab").protocolContext;
    const owner = codec.createMember(
      { userId: "owner", name: "Owner" },
      "owner-connection",
      1000,
      context,
    );
    const reader = codec.createMember(
      { userId: "reader", name: "Reader" },
      "reader-connection",
      1000,
      receiverContext,
    );
    const point = {
      blockId: "passage",
      anchor: { type: "boundary", edge: "start", affinity: "after" },
    };
    const result = codec.command?.(
      owner,
      [reader],
      {
        id: "invite",
        action: {
          type: "invite",
          anchor: { anchor: point, focus: point },
          recipients: ["reader:tab"],
        },
      },
      1000,
      context,
    );
    expect(result).toBeDefined();
    const frame = codec.encode(
      PRESENCE_FRAME.Extension,
      "room",
      "owner-connection",
      result?.payload,
    );
    expect(codec.filterFrame?.(frame, undefined)).toBeNull();
    expect(
      JSON.stringify(
        codec.filterFrame?.(frame, auth("other", "tab").protocolContext),
      ),
    ).not.toContain('"blockId":"passage"');
    expect(
      JSON.stringify(codec.filterFrame?.(frame, receiverContext)),
    ).toContain('"blockId":"passage"');
    expect(
      JSON.stringify(codec.filterFrame?.(frame, receiverContext)),
    ).not.toContain("attentionReceipts");
  });
});
