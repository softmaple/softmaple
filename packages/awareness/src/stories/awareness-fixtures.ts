import { ACTIVITY_TYPE } from "../constants/presence-events";
import type { ActivityEvent } from "../types/events";
import type { PresenceUser } from "../types/presence";
import bulbasaurSprite from "./assets/pokemon-1.png";
import charmanderSprite from "./assets/pokemon-4.png";
import squirtleSprite from "./assets/pokemon-7.png";
import pikachuSprite from "./assets/pokemon-25.png";
import psyduckSprite from "./assets/pokemon-54.png";
import eeveeSprite from "./assets/pokemon-133.png";

const baseTime = Date.UTC(2026, 4, 10, 9, 30);

export const pikachu = {
  userId: "pikachu",
  name: "Pikachu",
  avatarUrl: pikachuSprite,
  color: "#854d0e",
  status: "active",
  lastActiveAt: baseTime + 4000,
  cursor: { blockId: "abstract", offset: 42 },
  selection: { blockId: "abstract", from: 12, to: 56 },
  meta: { isTyping: true },
} satisfies PresenceUser;

export const bulbasaur = {
  userId: "bulbasaur",
  name: "Bulbasaur",
  avatarUrl: bulbasaurSprite,
  color: "#166534",
  status: "active",
  lastActiveAt: baseTime + 3000,
  cursor: { blockId: "methods", offset: 18 },
} satisfies PresenceUser;

export const charmander = {
  userId: "charmander",
  name: "Charmander",
  avatarUrl: charmanderSprite,
  color: "#9a3412",
  status: "idle",
  lastActiveAt: baseTime + 2000,
  selection: { blockId: "results", from: 4, to: 27 },
} satisfies PresenceUser;

export const squirtle = {
  userId: "squirtle",
  name: "Squirtle",
  avatarUrl: squirtleSprite,
  color: "#0369a1",
  status: "idle",
  lastActiveAt: baseTime + 1000,
} satisfies PresenceUser;

export const eevee = {
  userId: "eevee",
  name: "Eevee",
  avatarUrl: eeveeSprite,
  color: "#92400e",
  status: "offline",
  lastActiveAt: baseTime,
} satisfies PresenceUser;

export const psyduck = {
  userId: "psyduck",
  name: "Psyduck",
  avatarUrl: psyduckSprite,
  color: "#0e7490",
  status: "active",
  lastActiveAt: baseTime + 5000,
} satisfies PresenceUser;

export const collaborators = [
  pikachu,
  bulbasaur,
  charmander,
  squirtle,
  eevee,
  psyduck,
] satisfies ReadonlyArray<PresenceUser>;

export const usersById = new Map(
  collaborators.map((user) => [user.userId, user]),
) satisfies ReadonlyMap<string, PresenceUser>;

export interface PokemonFlavor {
  readonly type: string;
  readonly accent: string;
}

export const pokemonFlavor = {
  pikachu: { type: "Electric", accent: "#facc15" },
  bulbasaur: { type: "Grass", accent: "#22c55e" },
  charmander: { type: "Fire", accent: "#f97316" },
  squirtle: { type: "Water", accent: "#38bdf8" },
  eevee: { type: "Normal", accent: "#a78bfa" },
  psyduck: { type: "Water", accent: "#fcd34d" },
} as const satisfies Record<string, PokemonFlavor>;

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
