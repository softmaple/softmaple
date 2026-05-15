import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useRef,
} from "react";
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
const hostCardStyle: CSSProperties = {
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
};

/**
 * The layer requires a `host` ref that can only be constructed inside
 * a render (refs aren't serializable into `args`). We hand the meta
 * `component: PresenceLayer` for autodocs and then let the decorator
 * own the ref + the demo card the cursor/selection anchor to. Stories
 * receive the rendered `<PresenceLayer>` via `<Story />`, so the
 * `args` table (host=hidden, className) stays useful even though the
 * `host` prop itself is never user-tweakable.
 */
const HostDecorator = ({ children }: { children: ReactNode }): ReactNode => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  return (
    <StoryShowcase
      eyebrow="PresenceLayer"
      subtitle="LiveCursor and SelectionHighlight inside a PresenceLayer use coordinates relative to the host element. The layer handles screen-space translation."
      title="Anchored to a host element"
    >
      <div ref={hostRef} style={hostCardStyle}>
        Each peer's caret and selection lives in a fixed-position layer anchored
        to this card. Resize the window or scroll the story — the overlays
        follow because the layer tracks the host's bounding rect for you.
      </div>
      <PresenceLayer host={hostRef}>{children}</PresenceLayer>
    </StoryShowcase>
  );
};

// Sentinel ref handed to the meta so Storybook's args/autodocs machinery
// has a value for the required `host` prop. Stories never render against
// this ref directly — `HostDecorator` mounts a real host element and
// owns the real `<PresenceLayer>`; the per-story `render` only returns
// the cursor/selection children that go inside it.
const placeholderHostRef: RefObject<HTMLElement | null> = { current: null };

const meta: Meta<typeof PresenceLayer> = {
  title: "Awareness/PresenceLayer",
  component: PresenceLayer,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    host: placeholderHostRef,
  },
  argTypes: {
    // The host ref is supplied by `HostDecorator`; surfacing it as a
    // Storybook control would just render an `[object Object]` input
    // for every story. Hide it from the docs table.
    host: { control: false, table: { disable: true } },
    children: { control: false, table: { disable: true } },
  },
  // Stories pass `<LiveCursor>` / `<SelectionHighlight>` as the layer's
  // children via their own `render`; `HostDecorator` wraps the result
  // in the demo card + a real `<PresenceLayer host={ref}>` so autodocs
  // can keep `component: PresenceLayer` without forcing every story to
  // wire its own ref.
  decorators: [
    (Story) => (
      <HostDecorator>
        <Story />
      </HostDecorator>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const HostedToTextarea: Story = {
  render: () => (
    <>
      <LiveCursor point={{ x: 24, y: 26 }} showLabel={false} user={bulbasaur} />
      <SelectionHighlight
        rect={{ x: 24, y: 60, width: 220, height: 22 }}
        showLabel="hover"
        user={charmander}
      />
    </>
  ),
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
