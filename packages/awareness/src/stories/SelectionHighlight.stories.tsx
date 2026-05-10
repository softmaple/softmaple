import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { SelectionHighlight } from "../components/selection-highlight";
import { ada, katherine } from "./awareness-fixtures";
import { CollaborationSurface } from "./story-layout";

const focusSelection = {
  rect: { x: 36, y: 58, width: 158, height: 24 },
  text: "focus from the document.",
} as const;

const currentPresenceSelection = {
  rect: { x: 194, y: 118, width: 122, height: 24 },
  text: "currently present.",
} as const;

const remoteActivitySelection = {
  rect: { x: 36, y: 94, width: 410, height: 24 },
  text: "Remote cursors and selections anchor activity to the text, while",
} as const;

const overlappingActivitySelection = {
  rect: { x: 156, y: 94, width: 290, height: 24 },
  text: "selections anchor activity to the text, while",
} as const;

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
    await expect(selection).toHaveStyle({ height: "24px", width: "158px" });
    await expect(selection.getAttribute("style")).toContain(
      "translate3d(36px, 58px, 0px)",
    );
    await expect(canvas.getByText("Katherine Johnson")).toBeVisible();
  },
};

export const InlineSelection: Story = {
  args: {
    rect: currentPresenceSelection.rect,
    selectedText: currentPresenceSelection.text,
    showLabel: false,
    user: ada,
  },
  play: async ({ canvas }) => {
    const selection = canvas.getByRole("img", {
      name: `Ada Lovelace selection: ${currentPresenceSelection.text}`,
    });

    await expect(selection).toBeVisible();
    await expect(selection).toHaveStyle({ height: "24px", width: "122px" });
    await expect(selection.getAttribute("style")).toContain(
      "translate3d(194px, 118px, 0px)",
    );
    await expect(canvas.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  },
};

export const OverlappingSelections: Story = {
  render: () => (
    <CollaborationSurface>
      <SelectionHighlight
        rect={remoteActivitySelection.rect}
        selectedText={remoteActivitySelection.text}
        showLabel
        user={katherine}
      />
      <SelectionHighlight
        rect={overlappingActivitySelection.rect}
        selectedText={overlappingActivitySelection.text}
        showLabel
        user={ada}
      />
    </CollaborationSurface>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", {
        name: `Katherine Johnson selection: ${remoteActivitySelection.text}`,
      }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("img", {
        name: `Ada Lovelace selection: ${overlappingActivitySelection.text}`,
      }),
    ).toBeVisible();
    await expect(canvas.getByText("Katherine Johnson")).toBeVisible();
    await expect(canvas.getByText("Ada Lovelace")).toBeVisible();
  },
};
