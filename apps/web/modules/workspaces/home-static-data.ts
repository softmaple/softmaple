/** Presentation-only examples. No API, membership, presence or notification state. */
export const SPACE_EXAMPLES = [
  { name: "Product", color: "var(--ws-purple)" },
  { name: "Ideas", color: "var(--ws-blue)" },
  { name: "Personal", color: "var(--ws-green)" },
] as const;
export const UPDATE_EXAMPLES = [
  {
    name: "Mia",
    action: "commented in",
    time: "10m ago",
    quote:
      "This direction feels right. Let’s make it even clearer in the next section.",
    avatar_src: "/workspace/mia.jpg",
  },
  {
    name: "Leo",
    action: "highlighted text in",
    time: "28m ago",
    quote: "minds to write together,",
    avatar_src: "/workspace/leo.jpg",
  },
] as const;
