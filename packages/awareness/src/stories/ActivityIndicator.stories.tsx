import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { ActivityIndicator } from "../components/activity-indicator";
import { recentActivities, usersById } from "./awareness-fixtures";
import { StoryShowcase } from "./story-layout";

const meta = {
  title: "Awareness/ActivityIndicator",
  component: ActivityIndicator,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    activities: recentActivities,
    users: usersById,
  },
  render: (args) => (
    <StoryShowcase
      eyebrow="Pokédex · Activity"
      subtitle="Recent collaboration events with type-coded glyphs for typing, cursor, selection, and idle."
      title="Activity feed"
    >
      <ActivityIndicator {...args} />
    </StoryShowcase>
  ),
} satisfies Meta<typeof ActivityIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RecentActivity: Story = {
  args: {
    maxItems: 4,
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByLabelText("Recent collaboration activity"),
    ).toBeVisible();
    await expect(canvas.getByText("Pikachu is typing")).toBeVisible();
    await expect(canvas.getByText("Bulbasaur moved cursor")).toBeVisible();
    await expect(canvas.getByText("Charmander selected text")).toBeVisible();
    await expect(canvas.getByText("Squirtle is idle")).toBeVisible();
  },
};

export const LimitedActivity: Story = {
  args: {
    maxItems: 2,
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByLabelText("Recent collaboration activity"),
    ).toBeVisible();
    await expect(canvas.getByText("Pikachu is typing")).toBeVisible();
    await expect(canvas.getByText("Bulbasaur moved cursor")).toBeVisible();
    await expect(
      canvas.queryByText("Charmander selected text"),
    ).not.toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: {
    activities: [],
    emptyLabel: "No collaboration activity yet",
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByLabelText("Recent collaboration activity"),
    ).toBeVisible();
    await expect(
      canvas.getByText("No collaboration activity yet"),
    ).toBeVisible();
  },
};
