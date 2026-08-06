import type { FileRouteTypes } from "@/routeTree.gen";

export interface DemoItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly link: FileRouteTypes["to"];
  readonly badge?: string;
  readonly accent: string;
}

export const demos: ReadonlyArray<DemoItem> = [
  {
    id: "01",
    title: "Lexical × EG-walker",
    description:
      "Rich-text collaboration with Lexical, block-model CRDT, WebSocket document sync, and live presence. Open the same room in two browsers to verify.",
    link: "/demo/lexical-eg-walker",
    badge: "WebSocket",
    accent: "#2DD4BF",
  },
  {
    id: "02",
    title: "Online Collaborative Editor",
    description:
      "Create or join rooms and sync plain-text editing over WebSocket. Share the room link to collaborate across browsers.",
    link: "/demo/online-collab-editor",
    badge: "WebSocket",
    accent: "#FB923C",
  },
  {
    id: "03",
    title: "Awareness + Eg-Walker",
    description:
      "Pick a Pokémon trainer and collaborate with live cursors, selection highlights, and presence indicators from @softmaple/awareness.",
    link: "/demo/awareness-collab",
    accent: "#818CF8",
  },
  {
    id: "04",
    title: "Collaborative Editor",
    description:
      "Side-by-side text editors powered by the Eg-Walker CRDT. Type in either panel to see instant local synchronization.",
    link: "/demo/collaborative-editor",
    accent: "#60A5FA",
  },
  {
    id: "05",
    title: "Two-Panel Editor Demo",
    description:
      "Independent text editors side-by-side. Useful for comparing drafts, note-taking, or dual-language editing.",
    link: "/demo/two-panel-editor",
    accent: "#A78BFA",
  },
];
