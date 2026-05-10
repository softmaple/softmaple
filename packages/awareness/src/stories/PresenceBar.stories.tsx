import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { PresenceBar } from "../components/presence-bar";
import { collaborators } from "./awareness-fixtures";
import { StoryFrame } from "./story-layout";

const meta = {
  title: "Awareness/PresenceBar",
  component: PresenceBar,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  args: {
    users: collaborators,
  },
  render: (args) => (
    <StoryFrame>
      <PresenceBar {...args} />
    </StoryFrame>
  ),
} satisfies Meta<typeof PresenceBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnlineCollaborators: Story = {
  args: {
    maxVisible: 4,
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("list", { name: "Collaborators" }),
    ).toBeVisible();
    await expect(canvas.getByText("+1")).toBeVisible();
    await expect(
      canvas.queryByRole("img", { name: "Mary Jackson, offline" }),
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
      canvas.getByRole("img", { name: "Mary Jackson, offline" }),
    ).toBeVisible();
    await expect(canvas.getByText("+1")).toBeVisible();
  },
};

export const Empty: Story = {
  args: {
    emptyLabel: "No one else is editing",
    users: [],
  },
  play: async ({ canvas }) => {
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
      canvas.getByRole("img", { name: "Dorothy Vaughan, active" }),
    ).toBeVisible();
  },
};
