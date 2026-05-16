import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { PresenceBar } from "../components/presence-bar";
import { collaborators } from "./awareness-fixtures";
import { StoryShowcase } from "./story-layout";

const meta = {
  title: "Awareness/PresenceBar",
  component: PresenceBar,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    users: collaborators,
  },
  render: (args) => (
    <StoryShowcase
      eyebrow="Pokédex · Roster"
      subtitle="Stacked avatars with overflow handling for the active editing party."
      title="Trainer roster"
    >
      <PresenceBar {...args} />
    </StoryShowcase>
  ),
} satisfies Meta<typeof PresenceBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnlineCollaborators: Story = {
  args: {
    maxVisible: 4,
  },
  play: async ({ canvas }) => {
    const collaboratorsList = canvas.getByRole("list", {
      name: "Collaborators",
    });

    await expect(collaboratorsList).toBeVisible();
    await expect(
      canvas.getByRole("listitem", {
        name: "1 more collaborators: Squirtle",
      }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("img", { name: "Eevee, offline" }),
    ).not.toBeInTheDocument();
  },
};

export const IncludeOffline: Story = {
  args: {
    includeOffline: true,
    maxVisible: 5,
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("listitem", {
        name: "1 more collaborators: Eevee",
      }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("img", { name: "Squirtle, idle" }),
    ).toBeVisible();
  },
};

export const Empty: Story = {
  args: {
    emptyLabel: "No one else is editing",
    users: [],
  },
  play: async ({ canvas }) => {
    // Empty roster renders a status region, not a list — see the
    // "Empty roster gets its own status region" branch in
    // `presence-bar.tsx`. Announcing through `role="status"` reads
    // better than "Collaborators list, 1 item, No collaborators
    // online" and avoids axe's `role="status"` on `<li>` warning.
    await expect(
      canvas.getByRole("status", { name: "Collaborators" }),
    ).toBeVisible();
    await expect(canvas.getByText("No one else is editing")).toBeVisible();
  },
};

export const LargeAvatars: Story = {
  args: {
    maxVisible: 6,
    size: "lg",
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Psyduck, active" }),
    ).toHaveClass("awareness-avatar--lg");
  },
};

export const Loading: Story = {
  args: {
    loading: true,
    maxVisible: 4,
    users: [],
  },
  play: async ({ canvas }) => {
    const list = canvas.getByRole("list", { name: "Collaborators" });
    await expect(list).toHaveAttribute("aria-busy", "true");
    // The skeletons are decorative (animation suppressed per design
    // §6 "no persistent animation"), so the AT signal lives in a
    // sibling `role="status"` region. Use getByText because
    // Playwright's accessibility tree filters out the visually-hidden
    // (`awareness-sr-only`) status node; the text presence is enough
    // to confirm the live region is wired.
    await expect(
      canvas.getByText("Loading collaborators…"),
    ).toBeInTheDocument();
  },
};
