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
    const collaboratorsList = canvas.getByRole("list", {
      name: "Collaborators",
    });

    await expect(collaboratorsList).toBeVisible();
    await expect(
      canvas.getByRole("listitem", {
        name: "1 more collaborators: Alan Turing",
      }),
    ).toBeVisible();
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
      canvas.getByRole("listitem", {
        name: "1 more collaborators: Mary Jackson",
      }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("img", { name: "Alan Turing, idle" }),
    ).toBeVisible();
  },
};

export const Empty: Story = {
  args: {
    emptyLabel: "No one else is editing",
    users: [],
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("list", { name: "Collaborators" }),
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
      canvas.getByRole("img", { name: "Dorothy Vaughan, active" }),
    ).toHaveClass("awareness-avatar--lg");
  },
};
