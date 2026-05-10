import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { PresenceAvatar } from "../components/presence-avatar";
import { ada, grace, katherine, mary } from "./awareness-fixtures";
import { StoryFrame } from "./story-layout";

const meta = {
  title: "Awareness/PresenceAvatar",
  component: PresenceAvatar,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    user: ada,
  },
  render: (args) => (
    <StoryFrame>
      <PresenceAvatar {...args} />
    </StoryFrame>
  ),
} satisfies Meta<typeof PresenceAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
  play: async ({ canvas }) => {
    const avatar = canvas.getByRole("img", { name: "Ada Lovelace, active" });

    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveClass("awareness-avatar--active");
    await expect(avatar).toHaveStyle({ "--awareness-user-color": "#2563eb" });
    await expect(canvas.getByText("AL")).toBeVisible();
  },
};

export const Idle: Story = {
  args: {
    user: katherine,
  },
  play: async ({ canvas }) => {
    const avatar = canvas.getByRole("img", {
      name: "Katherine Johnson, idle",
    });

    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveClass("awareness-avatar--idle");
  },
};

export const OfflineWithoutStatus: Story = {
  args: {
    showStatus: false,
    user: mary,
  },
  play: async ({ canvas }) => {
    const avatar = canvas.getByRole("img", { name: "Mary Jackson, offline" });

    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveClass("awareness-avatar--offline");
    await expect(avatar.querySelector(".awareness-avatar__status")).toBeNull();
  },
};

export const Sizes: Story = {
  render: () => (
    <StoryFrame>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <PresenceAvatar size="sm" user={ada} />
        <PresenceAvatar size="md" user={grace} />
        <PresenceAvatar size="lg" user={katherine} />
      </div>
    </StoryFrame>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Ada Lovelace, active" }),
    ).toHaveClass("awareness-avatar--sm");
    await expect(
      canvas.getByRole("img", { name: "Grace Hopper, active" }),
    ).toHaveClass("awareness-avatar--md");
    await expect(
      canvas.getByRole("img", { name: "Katherine Johnson, idle" }),
    ).toHaveClass("awareness-avatar--lg");
  },
};
