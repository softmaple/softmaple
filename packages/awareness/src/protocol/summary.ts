import { isPresenceUser } from "./member";

export interface PresenceSummary {
  readonly people: number;
  readonly editing: number;
}
/** Coarse, person-grouped overview. Contains no names, locations or invitations. */
export const summarizePresence = (
  members: readonly unknown[],
  now: number,
): PresenceSummary => {
  const live = members
    .filter(isPresenceUser)
    .filter(
      (member) =>
        member.status !== "offline" && now - member.lastSeenAt < 30_000,
    );
  return {
    people: new Set(live.map((member) => member.userId)).size,
    editing: new Set(
      live
        .filter(
          (member) =>
            member.meta?.foreground !== false &&
            member.meta?.activity === "editing" &&
            now - member.lastActivityAt < 5_000,
        )
        .map((member) => member.userId),
    ).size,
  };
};
