import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLayoutEffect, useRef, useState } from "react";
import { expect, userEvent } from "storybook/test";
import { CollaborationBar } from "../components/collaboration-bar";
import { LiveCursor } from "../components/live-cursor";
import { PresenceLayer } from "../components/presence-layer";
import {
  type HighlightRect,
  SelectionHighlight,
} from "../components/selection-highlight";
import type { PresenceUser } from "../types/presence";

const person = (userId: string, name: string, color: string): PresenceUser => ({
  userId,
  connectionId: `${userId}-tab`,
  name,
  color,
  status: "active",
  lastActivityAt: 100,
  lastSeenAt: 100,
  clock: 0,
});
const maya = person("maya", "Maya Chen", "#2563eb");
const alex = {
  ...person("alex", "Alex Rivera", "#a16207"),
  meta: { isTyping: true },
};
const noor = {
  ...person("noor", "Noor Haddad", "#7c3aed"),
  status: "idle" as const,
};
const team = [maya, alex, noor, { ...maya, connectionId: "maya-second-tab" }];

const meta = {
  title: "Awareness/CollaborationBar",
  component: CollaborationBar,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: { users: team, selfUserId: "maya", state: "connected" },
  render: function CollaborationScene(args) {
    const [visible, setVisible] = useState(true);
    const host = useRef<HTMLElement>(null);
    const passage = useRef<HTMLSpanElement>(null);
    const [rects, setRects] = useState<ReadonlyArray<HighlightRect>>([]);
    useLayoutEffect(() => {
      const element = host.current;
      if (!element || !passage.current) return;
      const measure = () => {
        if (!passage.current) return;
        const bounds = element.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(passage.current);
        setRects(
          [...range.getClientRects()].map((rect) => ({
            x: rect.left - bounds.left,
            y: rect.top - bounds.top,
            width: rect.width,
            height: rect.height,
          })),
        );
      };
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      measure();
      return () => observer.disconnect();
    }, []);
    const lastRect = rects.at(-1);
    const showRemote =
      visible &&
      args.state === "connected" &&
      args.users?.some((user) => user.userId === alex.userId);
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "Canvas",
          color: "CanvasText",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <header
          style={{
            padding: "24px 28px 18px",
            borderBottom:
              "1px solid color-mix(in srgb, CanvasText 12%, transparent)",
          }}
        >
          <span style={{ fontSize: 12 }}>Softmaple / Research notes</span>
          <h1
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 28,
              fontWeight: 500,
              margin: "12px 0 0",
            }}
          >
            A shared understanding
          </h1>
        </header>
        <CollaborationBar
          {...args}
          cursorsVisible={visible}
          onCursorsVisibleChange={setVisible}
        />
        <article
          ref={host}
          style={{
            position: "relative",
            maxWidth: 640,
            margin: "48px auto",
            padding: "0 28px",
            fontFamily: "Georgia, serif",
            fontSize: 18,
            lineHeight: 1.85,
          }}
        >
          <p style={{ font: "12px system-ui, sans-serif", color: "inherit" }}>
            WORKING DRAFT · RESEARCH METHODS
          </p>
          <h2 style={{ fontSize: 32, lineHeight: 1.2, fontWeight: 400 }}>
            Better work, written together.
          </h2>
          <p>
            A good research document gives every contributor room to think. We
            bring our observations into one place,{" "}
            <span ref={passage}>compare what we have learned</span>, and find
            the questions worth asking next.
          </p>
          <h3 style={{ fontSize: 22, fontWeight: 400 }}>
            Start with what we know
          </h3>
          <p>
            Keep the evidence close to the argument. Make space for a second
            reading. The strongest ideas emerge when we can see the same page
            from a different perspective.
          </p>
          {showRemote ? (
            <PresenceLayer host={host}>
              {rects.map((rect) => (
                <SelectionHighlight
                  key={`${rect.x}-${rect.y}`}
                  user={alex}
                  rect={rect}
                />
              ))}
              {lastRect ? (
                <LiveCursor
                  user={alex}
                  point={{ x: lastRect.x + lastRect.width, y: lastRect.y }}
                  caretHeight={lastRect.height}
                  viewport="none"
                />
              ) : null}
            </PresenceLayer>
          ) : null}
        </article>
      </main>
    );
  },
} satisfies Meta<typeof CollaborationBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WritingTogether: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button", {
      name: "3 people here. Show collaborators",
    });
    await userEvent.click(trigger);
    await userEvent.tab();
    await expect(
      canvas.getByRole("list", { name: "People in this document" }),
    ).toHaveFocus();
    await expect(canvas.getByText("Here now · 2 sessions")).toBeVisible();
    await expect(canvas.getByText("Typing", { exact: true })).toBeVisible();
    await expect(canvas.getByText("Away", { exact: true })).toBeVisible();
    const preference = canvas.getByRole("checkbox", {
      name: "Show collaborator cursors",
    });
    await userEvent.click(preference);
    await expect(preference).not.toBeChecked();
    await expect(
      canvas.queryByRole("img", { name: "Alex Rivera cursor" }),
    ).toBeNull();
    await userEvent.click(preference);
    await expect(
      canvas.getByRole("img", { name: "Alex Rivera cursor" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(trigger).toHaveFocus();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{Enter}");
    await expect(
      canvas.getByRole("region", { name: "Collaborators in this document" }),
    ).toBeVisible();
  },
};
export const JustYou: Story = {
  args: { users: [maya] },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Just you here. Show collaborators" }),
    ).toBeVisible();
  },
};
export const Connecting: Story = {
  args: { state: "connecting" },
  play: async ({ canvas }) => {
    await expect(canvas.queryByText("3 people here")).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: "Collaboration details" }),
    );
    await expect(canvas.getByText(/Collaborators will appear/)).toBeVisible();
  },
};
export const Reconnecting: Story = { args: { state: "reconnecting" } };
export const Unavailable: Story = { args: { state: "error" } };
export const EmptyRoom: Story = {
  args: { users: [] },
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "0 people here. Show collaborators" }),
    );
    await expect(
      canvas.getByText("No collaborators are here yet."),
    ).toBeVisible();
  },
};
export const CrowdedRoom: Story = {
  args: {
    users: [
      ...team,
      person("leo", "Leo Martin", "#0f766e"),
      person("ana", "Ana Sofía García Fernández", "#be185d"),
      person("sam", "Sam Park", "#fef08a"),
    ],
  },
};
export const DarkRoom: Story = {
  decorators: [
    (Story) => (
      <div style={{ colorScheme: "dark" }}>
        <Story />
      </div>
    ),
  ],
  play: WritingTogether.play,
};
