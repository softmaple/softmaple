import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { BlockActivityIndicator } from "../components/block-activity-indicator";
import type { PresenceUser } from "../types/presence";
import { bulbasaur, charmander, pikachu } from "./awareness-fixtures";
import { StoryShowcase } from "./story-layout";

// `pikachu.cursor.blockId === "abstract"` — single user in this block.
const SINGLE_BLOCK_ID = "abstract";

// Two users sharing the same block, derived from fixtures so colors stay on-brand.
const SHARED_BLOCK_ID = "shared-paragraph";
const sharedBlockUsers: ReadonlyArray<PresenceUser> = [
  { ...bulbasaur, cursor: { blockId: SHARED_BLOCK_ID, offset: 0 } },
  { ...charmander, selection: { blockId: SHARED_BLOCK_ID, from: 0, to: 12 } },
];

const meta = {
  title: "Awareness/BlockActivityIndicator",
  component: BlockActivityIndicator,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    blockId: SINGLE_BLOCK_ID,
    users: [pikachu],
  },
  render: (args) => (
    <StoryShowcase
      subtitle="Compact pill that shows who is currently editing a specific block."
      title="Per-block badge"
    >
      <BlockActivityIndicator {...args} />
    </StoryShowcase>
  ),
} satisfies Meta<typeof BlockActivityIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleEditor: Story = {
  play: async ({ canvas }) => {
    const indicator = canvas.getByLabelText("Pikachu is editing this block");
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveTextContent("Pikachu is editing this block");
  },
};

export const MultipleEditors: Story = {
  args: {
    blockId: SHARED_BLOCK_ID,
    users: sharedBlockUsers,
  },
  play: async ({ canvas }) => {
    const indicator = canvas.getByLabelText("2 people editing here");
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveTextContent("2 people editing here");
  },
};

export const ExcludesOfflineUsers: Story = {
  args: {
    blockId: SINGLE_BLOCK_ID,
    users: [
      {
        ...pikachu,
        status: "offline",
      },
    ],
  },
  play: async ({ canvas }) => {
    // Offline peers do not count toward "who is editing here right now".
    await expect(canvas.queryByLabelText(/editing/i)).not.toBeInTheDocument();
  },
};

export const EmptyWithFallback: Story = {
  args: {
    blockId: "no-one-here",
    users: [pikachu, bulbasaur, charmander],
    renderWhenEmpty: true,
    emptyLabel: "No one editing here",
  },
  play: async ({ canvas }) => {
    const indicator = canvas.getByLabelText("No one editing here");
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveTextContent("No one editing here");
  },
};

export const CustomFormatter: Story = {
  args: {
    blockId: SHARED_BLOCK_ID,
    users: sharedBlockUsers,
    formatLabel: (users) =>
      users.length === 1
        ? `${users[0]?.name} is drafting`
        : `${users.length} collaborators here`,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("2 collaborators here")).toBeVisible();
  },
};
