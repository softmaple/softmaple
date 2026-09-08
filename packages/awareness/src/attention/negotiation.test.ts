import { describe, expect, it } from "vitest";
import {
  PRESENCE_CAPABILITIES,
  PRESENCE_PROTOCOL_VERSION,
} from "../protocol/version";
import {
  ATTENTION_CAPABILITIES,
  ATTENTION_PROTOCOL_VERSION,
  capableSessionIds,
  negotiate,
  SUPPORTED_CAPABILITIES,
  supports,
} from "./negotiation";

describe("negotiate", () => {
  it("agrees on version 3 when both ends speak it", () => {
    const session = negotiate({
      remote: SUPPORTED_CAPABILITIES,
      remoteVersion: ATTENTION_PROTOCOL_VERSION,
    });
    expect(session.version).toBe(ATTENTION_PROTOCOL_VERSION);
    expect(supports(session, "attentionInvitations")).toBe(true);
  });

  it("falls back to version 2 for an existing client", () => {
    const session = negotiate({
      remote: PRESENCE_CAPABILITIES,
      remoteVersion: PRESENCE_PROTOCOL_VERSION,
    });
    expect(session.version).toBe(PRESENCE_PROTOCOL_VERSION);
    // Plain presence still works; attention simply is not offered.
    expect(supports(session, "stableCursor")).toBe(true);
    for (const capability of Object.keys(ATTENTION_CAPABILITIES)) {
      expect(
        supports(session, capability as keyof typeof ATTENTION_CAPABILITIES),
      ).toBe(false);
    }
  });

  it("treats a missing capability record as a complete no", () => {
    const session = negotiate({
      remote: undefined,
      remoteVersion: PRESENCE_PROTOCOL_VERSION,
    });
    expect(session.version).toBe(PRESENCE_PROTOCOL_VERSION);
    expect(supports(session, "attentionState")).toBe(false);
  });

  it("intersects rather than unions, so nothing is claimed for the peer", () => {
    const session = negotiate({
      local: { attentionState: true, followRelationships: false },
      remote: { attentionState: true, followRelationships: true },
      remoteVersion: ATTENTION_PROTOCOL_VERSION,
    });
    expect(supports(session, "attentionState")).toBe(true);
    expect(supports(session, "followRelationships")).toBe(false);
  });

  it("ignores a capability name it has never heard of", () => {
    const session = negotiate({
      remote: {
        ...SUPPORTED_CAPABILITIES,
        somethingFromTheFuture: true,
      } as never,
      remoteVersion: 4,
    });
    expect(session.version).toBe(ATTENTION_PROTOCOL_VERSION);
    expect(Object.keys(session.capabilities)).toEqual(
      Object.keys(SUPPORTED_CAPABILITIES),
    );
  });

  it("stays on version 2 when only the remote is newer", () => {
    expect(
      negotiate({
        localVersion: PRESENCE_PROTOCOL_VERSION,
        remote: SUPPORTED_CAPABILITIES,
        remoteVersion: ATTENTION_PROTOCOL_VERSION,
      }).version,
    ).toBe(PRESENCE_PROTOCOL_VERSION);
  });
});

describe("capableSessionIds", () => {
  it("selects only the peers that can act on a command", () => {
    const rich = negotiate({
      remote: SUPPORTED_CAPABILITIES,
      remoteVersion: ATTENTION_PROTOCOL_VERSION,
    });
    const legacy = negotiate({
      remote: PRESENCE_CAPABILITIES,
      remoteVersion: PRESENCE_PROTOCOL_VERSION,
    });
    expect(
      capableSessionIds(
        new Map([
          ["new", rich],
          ["old", legacy],
        ]),
        "attentionInvitations",
      ),
    ).toEqual(["new"]);
  });
});
