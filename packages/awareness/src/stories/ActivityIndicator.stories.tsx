import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { ActivityIndicator } from "../components/activity-indicator";
import { recentActivities, usersById } from "./awareness-fixtures";
import { StoryFrame } from "./story-layout";

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
    <StoryFrame>
      <ActivityIndicator {...args} />
    </StoryFrame>
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
    await expect(canvas.getByText("Ada Lovelace is typing")).toBeVisible();
    await expect(canvas.getByText("Grace Hopper moved cursor")).toBeVisible();
    await expect(
      canvas.getByText("Katherine Johnson selected text"),
    ).toBeVisible();
    await expect(canvas.getByText("Alan Turing is idle")).toBeVisible();
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
    await expect(canvas.getByText("Ada Lovelace is typing")).toBeVisible();
    await expect(canvas.getByText("Grace Hopper moved cursor")).toBeVisible();
    await expect(
      canvas.queryByText("Katherine Johnson selected text"),
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
