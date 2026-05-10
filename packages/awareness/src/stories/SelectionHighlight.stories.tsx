import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { expect } from "storybook/test";

import { SelectionHighlight } from "../components/selection-highlight";
import { charmander, pikachu } from "./awareness-fixtures";
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
    user: charmander,
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
      name: `Charmander selection: ${focusSelection.text}`,
    });

    await expect(selection).toBeVisible();
    await expect(selection).toHaveStyle({ height: "24px", width: "172px" });
    await expect(selection.getAttribute("style")).toContain(
      "translate3d(36px, 36px, 0px)",
    );
    await expect(canvas.getByText("Charmander")).toBeVisible();
  },
};

export const InlineSelection: Story = {
  args: {
    rect: inlineSelection.rect,
    selectedText: inlineSelection.text,
    showLabel: false,
    user: pikachu,
  },
  play: async ({ canvas }) => {
    const selection = canvas.getByRole("img", {
      name: `Pikachu selection: ${inlineSelection.text}`,
    });

    await expect(selection).toBeVisible();
    await expect(selection).toHaveStyle({ height: "24px", width: "96px" });
    await expect(selection.getAttribute("style")).toContain(
      "translate3d(36px, 36px, 0px)",
    );
    await expect(canvas.queryByText("Pikachu")).not.toBeInTheDocument();
  },
};

// Design §5.3: "Hover reveals user badge."
// `showLabel="hover"` keeps the badge hidden until pointer hover or keyboard
// focus — so the highlight stays low-noise while still letting collaborators
// inspect attribution on demand.
//
// We assert the structural wiring (hoverable class, tabindex, label rendered
// but hidden by default) rather than the post-:hover computed style: synthetic
// hover events do not reliably trigger the CSS `:hover` pseudo-class across
// test browsers, so this story serves as the visual reference for Chromatic.
export const HoverableLabel: Story = {
  args: {
    showLabel: "hover",
    user: pikachu,
    selectedText: focusSelection.text,
  },
  play: async ({ canvas }) => {
    const selection = canvas.getByRole("img", {
      name: `Pikachu selection: ${focusSelection.text}`,
    });

    await expect(selection).toHaveClass(
      "awareness-selection-highlight--hoverable",
    );
    await expect(selection).toHaveAttribute("tabindex", "0");

    // The label is rendered into the DOM but hidden (opacity:0) until the
    // `:hover` / `:focus-visible` pseudo-class applies.
    const label = canvas.getByText("Pikachu");
    await expect(label).toBeInTheDocument();
    await expect(label).not.toBeVisible();

    // The selection is keyboard-focusable so screen-reader / keyboard users
    // can also surface the attribution.
    selection.focus();
    await expect(selection).toHaveFocus();
  },
};

export const OverlappingSelections: Story = {
  render: () => (
    <CollaborationSurface>
      <SelectionHighlight
        rect={firstLineSelection.rect}
        selectedText={firstLineSelection.text}
        showLabel
        user={charmander}
      />
      <SelectionHighlight
        rect={overlappingFirstLineSelection.rect}
        selectedText={overlappingFirstLineSelection.text}
        showLabel
        style={raisedSelectionLabelStyle}
        user={pikachu}
      />
    </CollaborationSurface>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", {
        name: `Charmander selection: ${firstLineSelection.text}`,
      }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("img", {
        name: `Pikachu selection: ${overlappingFirstLineSelection.text}`,
      }),
    ).toBeVisible();
    await expect(canvas.getByText("Charmander")).toBeVisible();
    await expect(canvas.getByText("Pikachu")).toBeVisible();
  },
};
