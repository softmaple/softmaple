/**
 * Pokémon trainer roster for the awareness + eg-walker playground demo.
 *
 * Each entry has two colors: `color` is the bright accent used in chips,
 * picker glow, and chrome text on dark surfaces; `userColor` is the
 * darker, contrast-safe value passed to the awareness adapter so that
 * white-on-color cursor and selection labels meet WCAG AA.
 */

export interface Trainer {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly userColor: string;
  readonly avatarUrl: string;
  readonly type: string;
}

const SPRITE_BASE =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

export const TRAINERS: ReadonlyArray<Trainer> = [
  {
    id: "pikachu",
    name: "Pikachu",
    color: "#facc15",
    userColor: "#854d0e",
    avatarUrl: `${SPRITE_BASE}/25.png`,
    type: "Electric",
  },
  {
    id: "bulbasaur",
    name: "Bulbasaur",
    color: "#22c55e",
    userColor: "#166534",
    avatarUrl: `${SPRITE_BASE}/1.png`,
    type: "Grass",
  },
  {
    id: "charmander",
    name: "Charmander",
    color: "#fb923c",
    userColor: "#9a3412",
    avatarUrl: `${SPRITE_BASE}/4.png`,
    type: "Fire",
  },
  {
    id: "squirtle",
    name: "Squirtle",
    color: "#38bdf8",
    userColor: "#0369a1",
    avatarUrl: `${SPRITE_BASE}/7.png`,
    type: "Water",
  },
  {
    id: "eevee",
    name: "Eevee",
    color: "#d4a373",
    userColor: "#92400e",
    avatarUrl: `${SPRITE_BASE}/133.png`,
    type: "Normal",
  },
  {
    id: "psyduck",
    name: "Psyduck",
    color: "#fde047",
    userColor: "#0e7490",
    avatarUrl: `${SPRITE_BASE}/54.png`,
    type: "Water",
  },
];

export const getTrainer = (id: string): Trainer | undefined =>
  TRAINERS.find((t) => t.id === id);
