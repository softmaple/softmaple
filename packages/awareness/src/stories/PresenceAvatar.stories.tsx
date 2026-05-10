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
    layout: "centered",
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
    await expect(
      canvas.getByRole("img", { name: "Ada Lovelace, active" }),
    ).toBeVisible();
    await expect(canvas.getByText("AL")).toBeVisible();
  },
};

export const Idle: Story = {
  args: {
    user: katherine,
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Katherine Johnson, idle" }),
    ).toBeVisible();
  },
};

export const OfflineWithoutStatus: Story = {
  args: {
    showStatus: false,
    user: mary,
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Mary Jackson, offline" }),
    ).toBeVisible();
    await expect(canvas.queryByTitle("Mary Jackson, offline")).toBeVisible();
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
    ).toBeVisible();
    await expect(
      canvas.getByRole("img", { name: "Grace Hopper, active" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("img", { name: "Katherine Johnson, idle" }),
    ).toBeVisible();
  },
};
