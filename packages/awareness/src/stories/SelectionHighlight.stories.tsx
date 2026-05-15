import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { expect } from "storybook/test";

import { PresenceLayer } from "../components/presence-layer";
import { SelectionHighlight } from "../components/selection-highlight";
import { charmander, pikachu } from "./awareness-fixtures";
import { CollaborationSurface, FIRST_LINE_Y } from "./story-layout";

// Coordinates are host-local (surface-card relative). The selection rects
// below land on paragraph 1 line 1 — "Collaborative editing keeps each
// trainer visible…" — which sits at `FIRST_LINE_Y` inside the surface.
// Exporting that constant from `story-layout.tsx` keeps all stories in
// register with a single number to change if the surface chrome is
// restyled.
const LINE_HEIGHT = 24;
const SECOND_LINE_Y = FIRST_LINE_Y + LINE_HEIGHT;
const THIRD_LINE_Y = FIRST_LINE_Y + 2 * LINE_HEIGHT;

const focusSelection = {
  rect: { x: 32, y: FIRST_LINE_Y, width: 172, height: LINE_HEIGHT },
  text: "Collaborative editing keeps",
} as const;

const inlineSelection = {
  rect: { x: 32, y: FIRST_LINE_Y, width: 96, height: LINE_HEIGHT },
  text: "Collaborative",
} as const;

const firstLineSelection = {
  rect: { x: 32, y: FIRST_LINE_Y, width: 172, height: LINE_HEIGHT },
  text: "Collaborative editing keeps",
} as const;

const overlappingFirstLineSelection = {
  rect: { x: 126, y: FIRST_LINE_Y, width: 82, height: LINE_HEIGHT },
  text: "editing keeps",
} as const;

// Three-rect selection mirroring the per-line rendering pattern that
// `getTextareaSelectionRects` produces for wrapped textarea selections
// — one rect per visible line so the highlight follows the text
// instead of painting a single bounding box over the unselected
// content between the wrap boundaries.
const multiLineSelection = {
  text: "each trainer visible without pulling focus from the page. Remote cursors anchor activity to the",
  rects: [
    // Line 1 partial: from mid-line to the content right edge.
    { x: 200, y: FIRST_LINE_Y, width: 296, height: LINE_HEIGHT },
    // Line 2 full-width: content left edge to right edge.
    { x: 32, y: SECOND_LINE_Y, width: 496, height: LINE_HEIGHT },
    // Line 3 partial: content left edge to mid-line.
    { x: 32, y: THIRD_LINE_Y, width: 220, height: LINE_HEIGHT },
  ],
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
  // SelectionHighlight requires a `<PresenceLayer>` ancestor — the
  // layer translates host-local rect coordinates into screen space.
  render: (args) => (
    <CollaborationSurface>
      {(surfaceRef) => (
        <PresenceLayer host={surfaceRef}>
          <SelectionHighlight {...args} />
        </PresenceLayer>
      )}
    </CollaborationSurface>
  ),
} satisfies Meta<typeof SelectionHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LabeledSelection: Story = {
  play: async ({ canvas }) => {
    // PresenceLayer renders its children only after measuring the host,
    // so use the async `findBy*` queries to wait for the second commit.
    const selection = await canvas.findByRole("img", {
      name: `Charmander selection: ${focusSelection.text}`,
    });

    await expect(selection).toBeVisible();
    await expect(selection).toHaveStyle({ height: "24px", width: "172px" });
    // No strict transform assertion — the rect's translate3d is now
    // host-rect-relative, which depends on viewport layout in a way that
    // makes hard-coded pixel values brittle.
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
    const selection = await canvas.findByRole("img", {
      name: `Pikachu selection: ${inlineSelection.text}`,
    });

    await expect(selection).toBeVisible();
    await expect(selection).toHaveStyle({ height: "24px", width: "96px" });
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
    const selection = await canvas.findByRole("img", {
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

/**
 * Wrapped multi-line selection — one `<SelectionHighlight>` per
 * visible line so the highlight follows the text instead of painting
 * one giant bounding box across the gap. This is the same per-line
 * rendering pattern that
 * `apps/playground/src/components/awareness-collab/EditorSurface.tsx`
 * builds via `rectsFor`. Only the first rect carries the user-visible
 * label and the full selectedText aria-label; sibling rects render as
 * unlabeled continuations of the same logical selection.
 */
export const MultiLineSelection: Story = {
  render: () => (
    <CollaborationSurface>
      {(surfaceRef) => (
        <PresenceLayer host={surfaceRef}>
          {multiLineSelection.rects.map((rect, i) => (
            <SelectionHighlight
              key={`multi-${rect.y}-${rect.x}`}
              rect={rect}
              selectedText={i === 0 ? multiLineSelection.text : undefined}
              showLabel={i === 0}
              user={charmander}
            />
          ))}
        </PresenceLayer>
      )}
    </CollaborationSurface>
  ),
  play: async ({ canvas }) => {
    // The first rect carries the full selectedText; the two
    // continuations render with the plain "<name> selection" aria so
    // assistive tech doesn't repeat the long text three times for a
    // single logical selection.
    const labelled = await canvas.findByRole("img", {
      name: `Charmander selection: ${multiLineSelection.text}`,
    });
    await expect(labelled).toBeVisible();
    const continuations = await canvas.findAllByRole("img", {
      name: "Charmander selection",
    });
    await expect(continuations).toHaveLength(
      multiLineSelection.rects.length - 1,
    );
    // Visible name badge appears once (on the first rect only).
    await expect(canvas.getByText("Charmander")).toBeVisible();
  },
};

export const OverlappingSelections: Story = {
  render: () => (
    <CollaborationSurface>
      {(surfaceRef) => (
        <PresenceLayer host={surfaceRef}>
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
        </PresenceLayer>
      )}
    </CollaborationSurface>
  ),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("img", {
        name: `Charmander selection: ${firstLineSelection.text}`,
      }),
    ).toBeVisible();
    await expect(
      await canvas.findByRole("img", {
        name: `Pikachu selection: ${overlappingFirstLineSelection.text}`,
      }),
    ).toBeVisible();
    await expect(canvas.getByText("Charmander")).toBeVisible();
    await expect(canvas.getByText("Pikachu")).toBeVisible();
  },
};
