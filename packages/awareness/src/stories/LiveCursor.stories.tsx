import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

import { LiveCursor } from "../components/live-cursor";
import { PresenceLayer } from "../components/presence-layer";
import { bulbasaur, charmander, pikachu } from "./awareness-fixtures";
import { CollaborationSurface } from "./story-layout";

const meta = {
  title: "Awareness/LiveCursor",
  component: LiveCursor,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  // Points are host-local (surface-card relative). y≈134 lands the caret
  // on paragraph 1 line 1 inside the demo surface; the chrome bar (~37px)
  // and page-content padding-top (26px) push the prose down from the
  // surface's top-left, which is the layer's reference point.
  args: {
    labelVisibleMs: 60_000,
    point: { x: 36, y: 134 },
    user: bulbasaur,
  },
  // The render function uses CollaborationSurface's render-prop form so
  // it can hand the surface ref to a `<PresenceLayer>`, which is now
  // required by `LiveCursor` (the layer translates host-local point
  // coordinates into screen space).
  render: (args) => (
    <CollaborationSurface>
      {(surfaceRef) => (
        <PresenceLayer host={surfaceRef}>
          <LiveCursor {...args} />
        </PresenceLayer>
      )}
    </CollaborationSurface>
  ),
} satisfies Meta<typeof LiveCursor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LabeledCursor: Story = {
  play: async ({ canvas }) => {
    // PresenceLayer's layout effect runs after first commit, so the
    // overlay only appears in the second render — wait for it.
    const cursor = await canvas.findByRole("img", {
      name: "Bulbasaur cursor",
    });

    await expect(cursor).toBeVisible();
    await expect(cursor).toHaveClass("awareness-live-cursor--label-visible");
    // Skip a strict transform assertion: the cursor's translate3d is now
    // host-rect-relative, which depends on viewport layout in a way that
    // makes hard-coded pixel values brittle.
    await expect(canvas.getByText("Bulbasaur")).toBeVisible();
  },
};

export const CursorOnly: Story = {
  args: {
    point: { x: 184, y: 134 },
    showLabel: false,
    user: pikachu,
  },
  play: async ({ canvas }) => {
    const cursor = await canvas.findByRole("img", { name: "Pikachu cursor" });

    await expect(cursor).toBeVisible();
    await expect(cursor).not.toHaveClass(
      "awareness-live-cursor--label-visible",
    );
    await expect(canvas.queryByText("Pikachu")).not.toBeInTheDocument();
  },
};

// Design §5.3: "Hover reveals user badge" — same opt-in pattern that
// SelectionHighlight uses, applied to the caret. The label is rendered into
// the DOM but hidden (opacity:0) until pointer hover or keyboard focus.
//
// As with the selection variant we assert the structural wiring (hoverable
// class, tabindex, label rendered but hidden by default) rather than the
// post-:hover computed style: synthetic hover events don't reliably trigger
// the CSS `:hover` pseudo-class across test browsers.
export const HoverableLabel: Story = {
  args: {
    point: { x: 36, y: 134 },
    showLabel: "hover",
    user: bulbasaur,
  },
  play: async ({ canvas }) => {
    const cursor = await canvas.findByRole("img", {
      name: "Bulbasaur cursor",
    });

    await expect(cursor).toHaveClass("awareness-live-cursor--hoverable");
    await expect(cursor).toHaveAttribute("tabindex", "0");
    await expect(cursor).not.toHaveClass(
      "awareness-live-cursor--label-visible",
    );

    const label = canvas.getByText("Bulbasaur");
    await expect(label).toBeInTheDocument();
    await expect(label).not.toBeVisible();

    cursor.focus();
    await expect(cursor).toHaveFocus();
  },
};

export const AutoHiddenLabel: Story = {
  args: {
    labelVisibleMs: 60,
    point: { x: 36, y: 134 },
    user: bulbasaur,
  },
  play: async ({ canvas }) => {
    const cursor = await canvas.findByRole("img", {
      name: "Bulbasaur cursor",
    });

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
      {(surfaceRef) => (
        <PresenceLayer host={surfaceRef}>
          <LiveCursor
            labelVisibleMs={60_000}
            point={{ x: 160, y: 95 }}
            showLabel={false}
            user={pikachu}
          />
          <LiveCursor
            labelVisibleMs={60_000}
            point={{ x: 176, y: 134 }}
            showLabel={false}
            user={charmander}
          />
        </PresenceLayer>
      )}
    </CollaborationSurface>
  ),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("img", { name: "Pikachu cursor" }),
    ).toBeVisible();
    await expect(
      await canvas.findByRole("img", { name: "Charmander cursor" }),
    ).toBeVisible();
    await expect(canvas.queryByText("Pikachu")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Charmander")).not.toBeInTheDocument();
  },
};

// Design §7: "Off-screen cursors not rendered."
// One cursor sits inside the visible window, the other is parked far
// off-screen via a host-local point that — once the layer adds the
// surface offset — lands well outside `window.innerWidth/innerHeight`.
// Default `viewport="window"` culls the off-screen one.
export const OffScreenCulled: Story = {
  render: () => (
    <CollaborationSurface>
      {(surfaceRef) => (
        <PresenceLayer host={surfaceRef}>
          <LiveCursor
            cullMargin={0}
            labelVisibleMs={60_000}
            point={{ x: 60, y: 95 }}
            user={pikachu}
          />
          <LiveCursor
            cullMargin={0}
            labelVisibleMs={60_000}
            point={{ x: 99999, y: 99999 }}
            user={charmander}
          />
        </PresenceLayer>
      )}
    </CollaborationSurface>
  ),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("img", { name: "Pikachu cursor" }),
    ).toBeVisible();
    // The charmander cursor's screen-translated point sits well outside
    // the window and the component returns null — it should not be in
    // the DOM at all.
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
      await canvas.findByRole("img", { name: "Pikachu cursor" }),
    ).toBeVisible();
  },
};
