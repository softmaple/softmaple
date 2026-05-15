/**
 * Pokémon trainer roster for the awareness + eg-walker playground demo.
 *
 * Each entry represents a stable trainer persona (id + display name +
 * accent color + sprite URL) so multiple tabs can each pick a distinct
 * trainer and render consistent avatars across the network.
 */

export interface Trainer {
  readonly id: string;
  readonly name: string;
  readonly color: string;
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
    avatarUrl: `${SPRITE_BASE}/25.png`,
    type: "Electric",
  },
  {
    id: "bulbasaur",
    name: "Bulbasaur",
    color: "#22c55e",
    avatarUrl: `${SPRITE_BASE}/1.png`,
    type: "Grass",
  },
  {
    id: "charmander",
    name: "Charmander",
    color: "#fb923c",
    avatarUrl: `${SPRITE_BASE}/4.png`,
    type: "Fire",
  },
  {
    id: "squirtle",
    name: "Squirtle",
    color: "#38bdf8",
    avatarUrl: `${SPRITE_BASE}/7.png`,
    type: "Water",
  },
  {
    id: "eevee",
    name: "Eevee",
    color: "#d4a373",
    avatarUrl: `${SPRITE_BASE}/133.png`,
    type: "Normal",
  },
  {
    id: "psyduck",
    name: "Psyduck",
    color: "#fde047",
    avatarUrl: `${SPRITE_BASE}/54.png`,
    type: "Water",
  },
];

export const getTrainer = (id: string): Trainer | undefined =>
  TRAINERS.find((t) => t.id === id);
