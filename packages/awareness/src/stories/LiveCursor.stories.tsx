import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

import { LiveCursor } from "../components/live-cursor";
import { bulbasaur, charmander, pikachu } from "./awareness-fixtures";
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
    user: bulbasaur,
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
    const cursor = canvas.getByRole("img", { name: "Bulbasaur cursor" });

    await expect(cursor).toBeVisible();
    await expect(cursor).toHaveClass("awareness-live-cursor--label-visible");
    await expect(cursor.getAttribute("style")).toContain(
      "translate3d(36px, 94px, 0px)",
    );
    await expect(canvas.getByText("Bulbasaur")).toBeVisible();
  },
};

export const CursorOnly: Story = {
  args: {
    point: { x: 184, y: 130 },
    showLabel: false,
    user: pikachu,
  },
  play: async ({ canvas }) => {
    const cursor = canvas.getByRole("img", { name: "Pikachu cursor" });

    await expect(cursor).toBeVisible();
    await expect(cursor).not.toHaveClass(
      "awareness-live-cursor--label-visible",
    );
    await expect(cursor.getAttribute("style")).toContain(
      "translate3d(184px, 130px, 0px)",
    );
    await expect(canvas.queryByText("Pikachu")).not.toBeInTheDocument();
  },
};

export const AutoHiddenLabel: Story = {
  args: {
    labelVisibleMs: 60,
    point: { x: 36, y: 94 },
    user: bulbasaur,
  },
  play: async ({ canvas }) => {
    const cursor = canvas.getByRole("img", { name: "Bulbasaur cursor" });

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
        user={pikachu}
      />
      <LiveCursor
        labelVisibleMs={60_000}
        point={{ x: 176, y: 130 }}
        showLabel={false}
        user={charmander}
      />
    </CollaborationSurface>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Pikachu cursor" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("img", { name: "Charmander cursor" }),
    ).toBeVisible();
    await expect(canvas.queryByText("Pikachu")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Charmander")).not.toBeInTheDocument();
  },
};

// Design §7: "Off-screen cursors not rendered."
// Two cursors share the same viewport — one inside, one outside — to make the
// culling decision visible side-by-side.
export const OffScreenCulled: Story = {
  render: () => (
    <CollaborationSurface>
      <LiveCursor
        cullMargin={0}
        labelVisibleMs={60_000}
        point={{ x: 60, y: 80 }}
        user={pikachu}
        viewport={{ x: 0, y: 0, width: 240, height: 200 }}
      />
      <LiveCursor
        cullMargin={0}
        labelVisibleMs={60_000}
        point={{ x: 9999, y: 9999 }}
        user={charmander}
        viewport={{ x: 0, y: 0, width: 240, height: 200 }}
      />
    </CollaborationSurface>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Pikachu cursor" }),
    ).toBeVisible();
    // The charmander cursor is well outside the bounded viewport and the
    // component returns null — it should not be in the DOM at all.
    await expect(
      canvas.queryByRole("img", { name: "Charmander cursor" }),
    ).not.toBeInTheDocument();
  },
};

// Same component, opt-out of culling via `viewport="none"`. The point is far
// outside the window but still rendered — useful for virtualized scrollers
// that have already culled upstream.
export const CullingDisabled: Story = {
  args: {
    point: { x: 4000, y: 4000 },
    user: pikachu,
    viewport: "none",
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Pikachu cursor" }),
    ).toBeVisible();
  },
};
