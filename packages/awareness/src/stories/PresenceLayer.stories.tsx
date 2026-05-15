import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { expect } from "storybook/test";

import { LiveCursor } from "../components/live-cursor";
import { PresenceLayer } from "../components/presence-layer";
import { SelectionHighlight } from "../components/selection-highlight";
import { bulbasaur, charmander } from "./awareness-fixtures";
import { StoryShowcase } from "./story-layout";

/**
 * `PresenceLayer` wraps the awareness overlay components and translates
 * their host-local coordinates into screen space, so consumers no longer
 * have to wire `getBoundingClientRect()` + scroll/resize listeners
 * themselves. Children pass coordinates relative to the host's top-left
 * (post host scroll) and the layer adds the host rect on render.
 */
// Loose typing (no `Meta<typeof PresenceLayer>`) because the story
// renders its own scene rather than spreading args into PresenceLayer —
// the layer requires a `host` ref that only makes sense to construct
// inside the render function.
const meta = {
  title: "Awareness/PresenceLayer",
  component: PresenceLayer,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Renders a fake editor card and anchors a cursor + selection to its
// inner text area via `<PresenceLayer host={...}>`. The point of the
// story is to demonstrate that the consumer only needs host-local
// coordinates — no manual `getBoundingClientRect()` math.
const HostedOverlays = () => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  return (
    <StoryShowcase
      eyebrow="PresenceLayer"
      subtitle="LiveCursor and SelectionHighlight inside a PresenceLayer use coordinates relative to the host element. The layer handles screen-space translation."
      title="Anchored to a host element"
    >
      <div
        ref={hostRef}
        style={{
          width: "min(520px, calc(100vw - 48px))",
          minHeight: 180,
          padding: "20px 24px",
          border: "1px solid color-mix(in srgb, CanvasText 12%, transparent)",
          borderRadius: 12,
          background: "Canvas",
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 14,
          lineHeight: 1.7,
          color: "CanvasText",
          position: "relative",
        }}
      >
        Each peer's caret and selection lives in a fixed-position layer anchored
        to this card. Resize the window or scroll the story — the overlays
        follow because the layer tracks the host's bounding rect for you.
      </div>
      <PresenceLayer host={hostRef}>
        <LiveCursor
          point={{ x: 24, y: 26 }}
          showLabel={false}
          user={bulbasaur}
        />
        <SelectionHighlight
          rect={{ x: 24, y: 60, width: 220, height: 22 }}
          showLabel="hover"
          user={charmander}
        />
      </PresenceLayer>
    </StoryShowcase>
  );
};

// `host` is required by PresenceLayer's prop type, so the type system
// insists on `args.host` even though the story's `render` ignores args
// entirely. A noop ref placeholder satisfies the contract.
const NOOP_HOST_REF = { current: null };

export const HostedToTextarea: Story = {
  args: { host: NOOP_HOST_REF },
  render: () => <HostedOverlays />,
  play: async ({ canvas }) => {
    // PresenceLayer renders null until its layout effect measures the
    // host and schedules a re-render with the offset, so use the async
    // `findBy*` queries to wait for the second commit.
    const cursor = await canvas.findByRole("img", {
      name: "Bulbasaur cursor",
    });
    const selection = await canvas.findByRole("img", {
      name: /Charmander selection/,
    });

    // We don't assert exact pixel positions because the host's bounding
    // rect depends on viewport layout — the contract under test is that
    // the layer renders its children once the host has been measured.
    await expect(cursor).toBeVisible();
    await expect(selection).toBeInTheDocument();

    // The hover-label selection is rendered with its hover wiring intact.
    await expect(selection).toHaveClass(
      "awareness-selection-highlight--hoverable",
    );
  },
};
