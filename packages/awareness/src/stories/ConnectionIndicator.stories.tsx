import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { ConnectionIndicator } from "../components/connection-indicator";
import { StoryShowcase } from "./story-layout";

const meta = {
  title: "Awareness/ConnectionIndicator",
  component: ConnectionIndicator,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  render: (args) => (
    <StoryShowcase
      eyebrow="Pokédex · Signal"
      subtitle="Low-noise indicator that quietly surfaces a degraded transport."
      title="Connection state"
    >
      <ConnectionIndicator {...args} />
    </StoryShowcase>
  ),
} satisfies Meta<typeof ConnectionIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connecting: Story = {
  args: { state: "connecting" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Connecting");
  },
};

export const Reconnecting: Story = {
  args: { state: "reconnecting" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Reconnecting");
  },
};

export const ErrorState: Story = {
  args: { state: "error" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toBeVisible();
  },
};

export const Disconnected: Story = {
  args: { state: "disconnected" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Offline");
  },
};

export const ConnectedRevealed: Story = {
  args: { state: "connected", hideWhenConnected: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Live");
  },
};
