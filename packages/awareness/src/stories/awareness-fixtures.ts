import { ACTIVITY_TYPE, type ActivityEvent } from "../types/events";
import type { PresenceUser } from "../types/presence";
import bulbasaurSprite from "./assets/pokemon-1.png";
import charmanderSprite from "./assets/pokemon-4.png";
import squirtleSprite from "./assets/pokemon-7.png";
import pikachuSprite from "./assets/pokemon-25.png";
import psyduckSprite from "./assets/pokemon-54.png";
import eeveeSprite from "./assets/pokemon-133.png";

const baseTime = Date.UTC(2026, 4, 10, 9, 30);

export interface PokemonFlavor {
  readonly type: string;
  // Bright tint for chips/badges; mixed down with Canvas before rendering.
  readonly accent: string;
  // Darker tint used as the PresenceUser color — drives the avatar gradient,
  // caret, and selection at high opacity, so it needs contrast on light bgs.
  readonly userColor: string;
}

export const pokemonFlavor = {
  pikachu: { type: "Electric", accent: "#facc15", userColor: "#854d0e" },
  bulbasaur: { type: "Grass", accent: "#22c55e", userColor: "#166534" },
  charmander: { type: "Fire", accent: "#f97316", userColor: "#9a3412" },
  squirtle: { type: "Water", accent: "#38bdf8", userColor: "#0369a1" },
  eevee: { type: "Normal", accent: "#a78bfa", userColor: "#92400e" },
  psyduck: { type: "Water", accent: "#fcd34d", userColor: "#0e7490" },
} as const satisfies Record<string, PokemonFlavor>;

export const pikachu = {
  userId: "pikachu",
  connectionId: "pikachu",
  name: "Pikachu",
  avatarUrl: pikachuSprite,
  color: pokemonFlavor.pikachu.userColor,
  status: "active",
  lastActivityAt: baseTime + 4000,
  lastSeenAt: baseTime + 4000,
  clock: 0,
  cursor: { blockId: "abstract", offset: 42 },
  selection: { blockId: "abstract", from: 12, to: 56 },
  meta: { isTyping: true },
} satisfies PresenceUser;

export const bulbasaur = {
  userId: "bulbasaur",
  connectionId: "bulbasaur",
  name: "Bulbasaur",
  avatarUrl: bulbasaurSprite,
  color: pokemonFlavor.bulbasaur.userColor,
  status: "active",
  lastActivityAt: baseTime + 3000,
  lastSeenAt: baseTime + 3000,
  clock: 0,
  cursor: { blockId: "methods", offset: 18 },
} satisfies PresenceUser;

export const charmander = {
  userId: "charmander",
  connectionId: "charmander",
  name: "Charmander",
  avatarUrl: charmanderSprite,
  color: pokemonFlavor.charmander.userColor,
  status: "idle",
  lastActivityAt: baseTime + 2000,
  lastSeenAt: baseTime + 2000,
  clock: 0,
  selection: { blockId: "results", from: 4, to: 27 },
} satisfies PresenceUser;

export const squirtle = {
  userId: "squirtle",
  connectionId: "squirtle",
  name: "Squirtle",
  avatarUrl: squirtleSprite,
  color: pokemonFlavor.squirtle.userColor,
  status: "idle",
  lastActivityAt: baseTime + 1000,
  lastSeenAt: baseTime + 1000,
  clock: 0,
} satisfies PresenceUser;

export const eevee = {
  userId: "eevee",
  connectionId: "eevee",
  name: "Eevee",
  avatarUrl: eeveeSprite,
  color: pokemonFlavor.eevee.userColor,
  status: "offline",
  lastActivityAt: baseTime,
  lastSeenAt: baseTime,
  clock: 0,
} satisfies PresenceUser;

export const psyduck = {
  userId: "psyduck",
  connectionId: "psyduck",
  name: "Psyduck",
  avatarUrl: psyduckSprite,
  color: pokemonFlavor.psyduck.userColor,
  status: "active",
  lastActivityAt: baseTime + 5000,
  lastSeenAt: baseTime + 5000,
  clock: 0,
} satisfies PresenceUser;

export const collaborators = [
  pikachu,
  bulbasaur,
  charmander,
  squirtle,
  eevee,
  psyduck,
] satisfies ReadonlyArray<PresenceUser>;

export const usersByConnectionId = new Map(
  collaborators.map((user) => [user.connectionId, user]),
) satisfies ReadonlyMap<string, PresenceUser>;

export const recentActivities = [
  {
    userId: "pikachu",
    timestamp: baseTime + 6000,
    type: ACTIVITY_TYPE.TYPING,
    data: { type: ACTIVITY_TYPE.TYPING, isTyping: true },
  },
  {
    userId: "bulbasaur",
    timestamp: baseTime + 5000,
    type: ACTIVITY_TYPE.CURSOR,
    data: {
      type: ACTIVITY_TYPE.CURSOR,
      position: { blockId: "methods", offset: 18 },
    },
  },
  {
    userId: "charmander",
    timestamp: baseTime + 4000,
    type: ACTIVITY_TYPE.SELECTION,
    data: {
      type: ACTIVITY_TYPE.SELECTION,
      range: { blockId: "results", from: 4, to: 27 },
    },
  },
  {
    userId: "squirtle",
    timestamp: baseTime + 3000,
    type: ACTIVITY_TYPE.IDLE,
    data: { type: ACTIVITY_TYPE.IDLE },
  },
] satisfies ReadonlyArray<ActivityEvent>;
