import type { FileRouteTypes } from "@/routeTree.gen";

export interface DemoItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly link: FileRouteTypes["to"];
  readonly badge?: string;
  readonly accent: string;
  readonly tags?: ReadonlyArray<string>;
  readonly featured?: boolean;
}

export const featuredDemo: DemoItem = {
  id: "01",
  title: "Lexical × EG-walker",
  description:
    "Rich-text collaboration with Lexical, block-model CRDT, WebSocket document sync, and live presence. Open the same room in two browsers to verify.",
  link: "/demo/lexical-eg-walker",
  badge: "Recommended",
  accent: "#0D9488",
  tags: ["Cross-browser", "WebSocket", "Rich text"],
  featured: true,
};

export const experimentDemos: ReadonlyArray<DemoItem> = [
  {
    id: "02",
    title: "Online Collaborative Editor",
    description:
      "Create or join rooms and sync plain-text editing over WebSocket. Share the room link to collaborate across browsers.",
    link: "/demo/online-collab-editor",
    badge: "WebSocket",
    accent: "#EA580C",
  },
  {
    id: "03",
    title: "Awareness + Eg-Walker",
    description:
      "Pick a Pokémon trainer and collaborate with live cursors, selection highlights, and presence indicators from @softmaple/awareness.",
    link: "/demo/awareness-collab",
    accent: "#DB2777",
  },
  {
    id: "04",
    title: "Collaborative Editor",
    description:
      "Side-by-side text editors powered by the Eg-Walker CRDT. Type in either panel to see instant local synchronization.",
    link: "/demo/collaborative-editor",
    accent: "#2563EB",
  },
  {
    id: "05",
    title: "Two-Panel Editor Demo",
    description:
      "Independent text editors side-by-side. Useful for comparing drafts, note-taking, or dual-language editing.",
    link: "/demo/two-panel-editor",
    accent: "#7C3AED",
  },
];

/** Flat list for nav / legacy consumers. */
export const demos: ReadonlyArray<DemoItem> = [
  featuredDemo,
  ...experimentDemos,
];
