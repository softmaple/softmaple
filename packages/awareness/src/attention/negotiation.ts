import {
  PRESENCE_CAPABILITIES,
  PRESENCE_PROTOCOL_VERSION,
  type PresenceCapability,
} from "../protocol/version";

/**
 * Capability negotiation for shared attention.
 *
 * The room already has v2 clients in it, and they will still be there after
 * this ships. So the rule is one-directional: a richer frame is only ever sent
 * to a peer that said it understands one, and a client that hears nothing back
 * about attention falls back to plain presence rather than degrading.
 *
 * Version 3 is additive. A v2 client's handshake is still valid, it simply
 * carries none of the attention capabilities, and the server treats its
 * absence as "no" rather than as an error.
 */

export const ATTENTION_PROTOCOL_VERSION = 3 as const;

export type NegotiableProtocolVersion =
  | typeof PRESENCE_PROTOCOL_VERSION
  | typeof ATTENTION_PROTOCOL_VERSION;

/** Capabilities added by version 3, on top of the version 2 set. */
export const ATTENTION_CAPABILITIES = {
  /** Tab-scoped session identity that survives reconnects. */
  sessionIdentity: true,
  /** Typed foreground / activity / semantic location / presenting state. */
  attentionState: true,
  /** Addressed, expiring "look here" invitations. */
  attentionInvitations: true,
  /** Follow start / suspend / resume / stop with presenter opt-in. */
  followRelationships: true,
} as const;

export type AttentionCapability = keyof typeof ATTENTION_CAPABILITIES;

export type NegotiableCapability = PresenceCapability | AttentionCapability;

/** Everything this build can do, for its own hello. */
export const SUPPORTED_CAPABILITIES = Object.freeze({
  ...PRESENCE_CAPABILITIES,
  ...ATTENTION_CAPABILITIES,
});

export type CapabilityDeclaration = Readonly<
  Partial<Record<NegotiableCapability, boolean>>
>;

export type NegotiatedSession = {
  /** What both ends agreed on. */
  readonly capabilities: Readonly<Record<NegotiableCapability, boolean>>;
  /** The highest version both ends understand. */
  readonly version: NegotiableProtocolVersion;
};

const ALL_CAPABILITY_NAMES = Object.keys(
  SUPPORTED_CAPABILITIES,
) as ReadonlyArray<NegotiableCapability>;

/**
 * Agree on a version and a capability set.
 *
 * Capabilities are intersected, never unioned: claiming support the peer does
 * not have is how a room ends up sending frames somebody cannot parse. An
 * unknown capability name from a newer peer is ignored rather than rejected,
 * so a future version can add one without breaking this build.
 */
export const negotiate = ({
  local = SUPPORTED_CAPABILITIES,
  localVersion = ATTENTION_PROTOCOL_VERSION,
  remote,
  remoteVersion,
}: {
  readonly local?: CapabilityDeclaration;
  readonly localVersion?: NegotiableProtocolVersion;
  readonly remote: CapabilityDeclaration | undefined;
  readonly remoteVersion: number;
}): NegotiatedSession => {
  const version: NegotiableProtocolVersion =
    remoteVersion >= ATTENTION_PROTOCOL_VERSION &&
    localVersion >= ATTENTION_PROTOCOL_VERSION
      ? ATTENTION_PROTOCOL_VERSION
      : PRESENCE_PROTOCOL_VERSION;

  const capabilities = Object.fromEntries(
    ALL_CAPABILITY_NAMES.map((name) => [
      name,
      // Absent means "no". A v2 client says nothing about attention, and that
      // is a complete, valid answer rather than something to guess about.
      local[name] === true && remote?.[name] === true,
    ]),
  ) as Record<NegotiableCapability, boolean>;

  return Object.freeze({ capabilities, version: Object.freeze(version) });
};

/** Whether a richer frame may be sent to this peer. */
export const supports = (
  session: NegotiatedSession,
  capability: NegotiableCapability,
): boolean => session.capabilities[capability] === true;

/**
 * The subset of peers a command may be delivered to.
 *
 * Used by the server to fan an attention command out only to sessions that
 * can act on it, so an older client is skipped rather than sent something it
 * will drop on the floor.
 */
export const capableSessionIds = (
  sessions: ReadonlyMap<string, NegotiatedSession>,
  capability: NegotiableCapability,
): ReadonlyArray<string> =>
  [...sessions.entries()]
    .filter(([, session]) => supports(session, capability))
    .map(([sessionId]) => sessionId);
