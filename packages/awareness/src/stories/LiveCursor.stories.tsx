import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { LiveCursor } from "../components/live-cursor";
import { ada, grace, katherine } from "./awareness-fixtures";
import { CollaborationSurface } from "./story-layout";

const meta = {
  title: "Awareness/LiveCursor",
  component: LiveCursor,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    labelVisibleMs: 60_000,
    point: { x: 168, y: 104 },
    user: grace,
  },
  render: (args) => (
    <CollaborationSurface>
      <LiveCursor {...args} />
    </CollaborationSurface>
  ),
} satisfies Meta<typeof LiveCursor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LabeledCursor: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Grace Hopper cursor" }),
    ).toBeVisible();
    await expect(canvas.getByText("Grace Hopper")).toBeVisible();
  },
};

export const CursorOnly: Story = {
  args: {
    point: { x: 328, y: 148 },
    showLabel: false,
    user: ada,
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Ada Lovelace cursor" }),
    ).toBeVisible();
    await expect(canvas.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  },
};

export const MultipleCursors: Story = {
  render: () => (
    <CollaborationSurface>
      <LiveCursor
        labelVisibleMs={60_000}
        point={{ x: 128, y: 76 }}
        user={ada}
      />
      <LiveCursor
        labelVisibleMs={60_000}
        point={{ x: 340, y: 154 }}
        user={katherine}
      />
    </CollaborationSurface>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Ada Lovelace")).toBeVisible();
    await expect(canvas.getByText("Katherine Johnson")).toBeVisible();
  },
};
