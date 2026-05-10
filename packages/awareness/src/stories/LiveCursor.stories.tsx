import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

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
    point: { x: 36, y: 94 },
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
    const cursor = canvas.getByRole("img", { name: "Grace Hopper cursor" });

    await expect(cursor).toBeVisible();
    await expect(cursor).toHaveClass("awareness-live-cursor--label-visible");
    await expect(cursor.getAttribute("style")).toContain(
      "translate3d(36px, 94px, 0px)",
    );
    await expect(canvas.getByText("Grace Hopper")).toBeVisible();
  },
};

export const CursorOnly: Story = {
  args: {
    point: { x: 184, y: 130 },
    showLabel: false,
    user: ada,
  },
  play: async ({ canvas }) => {
    const cursor = canvas.getByRole("img", { name: "Ada Lovelace cursor" });

    await expect(cursor).toBeVisible();
    await expect(cursor).not.toHaveClass(
      "awareness-live-cursor--label-visible",
    );
    await expect(cursor.getAttribute("style")).toContain(
      "translate3d(184px, 130px, 0px)",
    );
    await expect(canvas.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  },
};

export const AutoHiddenLabel: Story = {
  args: {
    labelVisibleMs: 60,
    point: { x: 36, y: 94 },
    user: grace,
  },
  play: async ({ canvas }) => {
    const cursor = canvas.getByRole("img", { name: "Grace Hopper cursor" });

    await expect(cursor).toHaveClass("awareness-live-cursor--label-visible");
    await waitFor(
      async () => {
        await expect(cursor).not.toHaveClass(
          "awareness-live-cursor--label-visible",
        );
      },
      { timeout: 1000 },
    );
  },
};

export const MultipleCursors: Story = {
  render: () => (
    <CollaborationSurface>
      <LiveCursor
        labelVisibleMs={60_000}
        point={{ x: 160, y: 58 }}
        showLabel={false}
        user={ada}
      />
      <LiveCursor
        labelVisibleMs={60_000}
        point={{ x: 176, y: 130 }}
        showLabel={false}
        user={katherine}
      />
    </CollaborationSurface>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Ada Lovelace cursor" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("img", { name: "Katherine Johnson cursor" }),
    ).toBeVisible();
    await expect(canvas.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    await expect(
      canvas.queryByText("Katherine Johnson"),
    ).not.toBeInTheDocument();
  },
};
