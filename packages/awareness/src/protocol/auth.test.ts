import { describe, expect, it } from "vitest";
import { parsePresenceAuth, parsePresenceHeartbeatPingId } from "./auth";
import { PRESENCE_CAPABILITIES, PRESENCE_PROTOCOL_VERSION } from "./version";

const validAuthPayload = () => ({
  token: "access-token",
  protocolVersion: PRESENCE_PROTOCOL_VERSION,
  capabilities: { ...PRESENCE_CAPABILITIES },
  connectionId: "connection-1",
  userId: "user-1",
});

describe("parsePresenceAuth", () => {
  it("parses a well-formed Auth payload", () => {
    expect(parsePresenceAuth(validAuthPayload())).toEqual({
      connectionId: "connection-1",
      token: "access-token",
      userId: "user-1",
    });
  });

  it("rejects a non-object payload", () => {
    expect(() => parsePresenceAuth("nope")).toThrow(
      "invalid presence authentication",
    );
  });

  it("rejects a missing/empty token", () => {
    expect(() =>
      parsePresenceAuth({ ...validAuthPayload(), token: "" }),
    ).toThrow("invalid presence authentication");
  });

  it("rejects an empty connectionId", () => {
    expect(() =>
      parsePresenceAuth({ ...validAuthPayload(), connectionId: "" }),
    ).toThrow("invalid presence authentication");
  });

  it("rejects a connectionId over 256 characters", () => {
    expect(() =>
      parsePresenceAuth({
        ...validAuthPayload(),
        connectionId: "c".repeat(257),
      }),
    ).toThrow("invalid presence authentication");
  });

  it("rejects a non-string userId", () => {
    expect(() =>
      parsePresenceAuth({ ...validAuthPayload(), userId: 123 }),
    ).toThrow("invalid presence authentication");
  });

  it("rejects an empty userId", () => {
    expect(() =>
      parsePresenceAuth({ ...validAuthPayload(), userId: "" }),
    ).toThrow("invalid presence authentication");
  });

  it("rejects a userId over 256 characters", () => {
    expect(() =>
      parsePresenceAuth({ ...validAuthPayload(), userId: "u".repeat(257) }),
    ).toThrow("invalid presence authentication");
  });

  it("accepts a JWT-length token", () => {
    // A Supabase access token is ~1000 characters; the 256 identifier bound
    // used to reject every real session with "invalid presence authentication".
    const token = `${"h".repeat(40)}.${"p".repeat(900)}.${"s".repeat(43)}`;
    expect(parsePresenceAuth({ ...validAuthPayload(), token }).token).toBe(
      token,
    );
  });

  it("accepts a token at the 4096 character bound", () => {
    const token = "t".repeat(4096);
    expect(parsePresenceAuth({ ...validAuthPayload(), token }).token).toBe(
      token,
    );
  });

  it("rejects a token over 4096 characters", () => {
    expect(() =>
      parsePresenceAuth({ ...validAuthPayload(), token: "t".repeat(4097) }),
    ).toThrow("invalid presence authentication");
  });

  it("rejects an unsupported protocolVersion", () => {
    expect(() =>
      parsePresenceAuth({ ...validAuthPayload(), protocolVersion: 999 }),
    ).toThrow("invalid presence authentication");
  });

  it("rejects a non-object capabilities value", () => {
    expect(() =>
      parsePresenceAuth({ ...validAuthPayload(), capabilities: "nope" }),
    ).toThrow("invalid presence authentication");
  });

  it.each(
    Object.keys(PRESENCE_CAPABILITIES),
  )("rejects an Auth payload missing capability %s", (capability) => {
    const payload = validAuthPayload();
    const capabilities = { ...payload.capabilities } as Record<string, unknown>;
    delete capabilities[capability];
    expect(() => parsePresenceAuth({ ...payload, capabilities })).toThrow(
      "unsupported presence capabilities",
    );
  });

  it("rejects an Auth payload with a flipped capability bit", () => {
    const payload = validAuthPayload();
    expect(() =>
      parsePresenceAuth({
        ...payload,
        capabilities: { ...payload.capabilities, presenceClock: false },
      }),
    ).toThrow("unsupported presence capabilities");
  });
});

describe("parsePresenceHeartbeatPingId", () => {
  it("returns a valid pingId", () => {
    expect(parsePresenceHeartbeatPingId({ pingId: "ping-1" })).toBe("ping-1");
  });

  it.each([
    ["a non-object payload", "nope"],
    ["a missing pingId", {}],
    ["an empty pingId", { pingId: "" }],
    ["an over-long pingId", { pingId: "p".repeat(129) }],
    ["a non-string pingId", { pingId: 1 }],
  ])("rejects %s", (_case, value) => {
    expect(() => parsePresenceHeartbeatPingId(value)).toThrow(
      "invalid presence heartbeat",
    );
  });
});
