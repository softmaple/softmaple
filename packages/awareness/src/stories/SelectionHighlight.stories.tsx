import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { SelectionHighlight } from "../components/selection-highlight";
import { ada, katherine } from "./awareness-fixtures";
import { CollaborationSurface } from "./story-layout";

const meta = {
  title: "Awareness/SelectionHighlight",
  component: SelectionHighlight,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    rect: { x: 34, y: 76, width: 368, height: 28 },
    showLabel: true,
    user: katherine,
  },
  render: (args) => (
    <CollaborationSurface>
      <SelectionHighlight {...args} />
    </CollaborationSurface>
  ),
} satisfies Meta<typeof SelectionHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LabeledSelection: Story = {
  play: async ({ canvas }) => {
    const selection = canvas.getByRole("img", {
      name: "Katherine Johnson selection",
    });

    await expect(selection).toBeVisible();
    await expect(selection).toHaveStyle({ height: "28px", width: "368px" });
    await expect(selection.getAttribute("style")).toContain(
      "translate3d(34px, 76px, 0px)",
    );
    await expect(canvas.getByText("Katherine Johnson")).toBeVisible();
  },
};

export const InlineSelection: Story = {
  args: {
    rect: { x: 176, y: 146, width: 214, height: 24 },
    showLabel: false,
    user: ada,
  },
  play: async ({ canvas }) => {
    const selection = canvas.getByRole("img", {
      name: "Ada Lovelace selection",
    });

    await expect(selection).toBeVisible();
    await expect(selection).toHaveStyle({ height: "24px", width: "214px" });
    await expect(selection.getAttribute("style")).toContain(
      "translate3d(176px, 146px, 0px)",
    );
    await expect(canvas.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  },
};

export const OverlappingSelections: Story = {
  render: () => (
    <CollaborationSurface>
      <SelectionHighlight
        rect={{ x: 34, y: 76, width: 368, height: 28 }}
        showLabel
        user={katherine}
      />
      <SelectionHighlight
        rect={{ x: 146, y: 111, width: 292, height: 28 }}
        showLabel
        user={ada}
      />
    </CollaborationSurface>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Katherine Johnson selection" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("img", { name: "Ada Lovelace selection" }),
    ).toBeVisible();
    await expect(canvas.getByText("Katherine Johnson")).toBeVisible();
    await expect(canvas.getByText("Ada Lovelace")).toBeVisible();
  },
};
