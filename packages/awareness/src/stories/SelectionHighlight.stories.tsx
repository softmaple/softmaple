import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { expect } from "storybook/test";

import { SelectionHighlight } from "../components/selection-highlight";
import { ada, katherine } from "./awareness-fixtures";
import { CollaborationSurface } from "./story-layout";

const focusSelection = {
  rect: { x: 36, y: 36, width: 172, height: 24 },
  text: "Collaborative editing keeps",
} as const;

const inlineSelection = {
  rect: { x: 36, y: 36, width: 96, height: 24 },
  text: "Collaborative",
} as const;

const firstLineSelection = {
  rect: { x: 36, y: 36, width: 172, height: 24 },
  text: "Collaborative editing keeps",
} as const;

const overlappingFirstLineSelection = {
  rect: { x: 126, y: 36, width: 82, height: 24 },
  text: "editing keeps",
} as const;

const raisedSelectionLabelStyle = {
  "--awareness-selection-label-y": "-22px",
} as CSSProperties;

const meta = {
  title: "Awareness/SelectionHighlight",
  component: SelectionHighlight,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    rect: focusSelection.rect,
    selectedText: focusSelection.text,
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
      name: `Katherine Johnson selection: ${focusSelection.text}`,
    });

    await expect(selection).toBeVisible();
    await expect(selection).toHaveStyle({ height: "24px", width: "172px" });
    await expect(selection.getAttribute("style")).toContain(
      "translate3d(36px, 36px, 0px)",
    );
    await expect(canvas.getByText("Katherine Johnson")).toBeVisible();
  },
};

export const InlineSelection: Story = {
  args: {
    rect: inlineSelection.rect,
    selectedText: inlineSelection.text,
    showLabel: false,
    user: ada,
  },
  play: async ({ canvas }) => {
    const selection = canvas.getByRole("img", {
      name: `Ada Lovelace selection: ${inlineSelection.text}`,
    });

    await expect(selection).toBeVisible();
    await expect(selection).toHaveStyle({ height: "24px", width: "96px" });
    await expect(selection.getAttribute("style")).toContain(
      "translate3d(36px, 36px, 0px)",
    );
    await expect(canvas.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  },
};

export const OverlappingSelections: Story = {
  render: () => (
    <CollaborationSurface>
      <SelectionHighlight
        rect={firstLineSelection.rect}
        selectedText={firstLineSelection.text}
        showLabel
        user={katherine}
      />
      <SelectionHighlight
        rect={overlappingFirstLineSelection.rect}
        selectedText={overlappingFirstLineSelection.text}
        showLabel
        style={raisedSelectionLabelStyle}
        user={ada}
      />
    </CollaborationSurface>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", {
        name: `Katherine Johnson selection: ${firstLineSelection.text}`,
      }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("img", {
        name: `Ada Lovelace selection: ${overlappingFirstLineSelection.text}`,
      }),
    ).toBeVisible();
    await expect(canvas.getByText("Katherine Johnson")).toBeVisible();
    await expect(canvas.getByText("Ada Lovelace")).toBeVisible();
  },
};
