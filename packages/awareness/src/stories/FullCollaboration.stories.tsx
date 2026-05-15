import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { expect } from "storybook/test";

import { ActivityIndicator } from "../components/activity-indicator";
import { BlockActivityIndicator } from "../components/block-activity-indicator";
import { ConnectionIndicator } from "../components/connection-indicator";
import { LiveCursor } from "../components/live-cursor";
import { PresenceBar } from "../components/presence-bar";
import { SelectionHighlight } from "../components/selection-highlight";
import type { PresenceUser } from "../types/presence";
import {
  bulbasaur,
  charmander,
  collaborators,
  pikachu,
  recentActivities,
  squirtle,
  usersById,
} from "./awareness-fixtures";
import { CollaborationSurface } from "./story-layout";

const SHARED_BLOCK_ID = "field-guide";

// Anchor the live awareness signals (cursors, selection, block badge) inside
// the same block so the story reads as a single coherent collaboration scene
// rather than three unrelated overlays.
const inBlock = (user: PresenceUser, blockId: string): PresenceUser => ({
  ...user,
  cursor: user.cursor ? { ...user.cursor, blockId } : user.cursor,
  selection: user.selection ? { ...user.selection, blockId } : user.selection,
});

const blockUsers: ReadonlyArray<PresenceUser> = [
  inBlock(pikachu, SHARED_BLOCK_ID),
  inBlock(bulbasaur, SHARED_BLOCK_ID),
  inBlock(charmander, SHARED_BLOCK_ID),
];

const overlayLayerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};

const topRailStyle: CSSProperties = {
  position: "absolute",
  top: -52,
  left: 0,
  right: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  pointerEvents: "auto",
};

const blockBadgePositionStyle: CSSProperties = {
  position: "absolute",
  left: 32,
  bottom: -36,
};

const activityFootnoteStyle: CSSProperties = {
  marginTop: 24,
  width: "min(560px, calc(100vw - 48px))",
  display: "grid",
  gap: 12,
  justifyItems: "stretch",
};

const meta = {
  title: "Awareness/FullCollaboration",
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Composite scene wiring every awareness primitive into a single
 * collaboration surface. Reads top-to-bottom as the real product would:
 * presence rail above the document, connection signal opposite, peer
 * cursors and selection over the prose, per-block badge anchored to the
 * affected block, and a recent-activity footnote below.
 */
export const TrainerHuddle: Story = {
  render: () => (
    <CollaborationSurface>
      <div style={overlayLayerStyle}>
        <div style={topRailStyle}>
          <PresenceBar maxVisible={5} users={collaborators} />
          <ConnectionIndicator hideWhenConnected={false} state="reconnecting" />
        </div>
        <SelectionHighlight
          rect={{ x: 36, y: 36, width: 172, height: 24 }}
          selectedText="Collaborative editing keeps"
          showLabel
          user={inBlock(charmander, SHARED_BLOCK_ID)}
        />
        <LiveCursor
          labelVisibleMs={60_000}
          point={{ x: 184, y: 130 }}
          user={inBlock(pikachu, SHARED_BLOCK_ID)}
          viewport="none"
        />
        <LiveCursor
          labelVisibleMs={60_000}
          point={{ x: 96, y: 184 }}
          showLabel={false}
          user={inBlock(bulbasaur, SHARED_BLOCK_ID)}
          viewport="none"
        />
        <div style={blockBadgePositionStyle}>
          <BlockActivityIndicator
            blockId={SHARED_BLOCK_ID}
            users={blockUsers}
          />
        </div>
      </div>
      <div style={activityFootnoteStyle}>
        <ActivityIndicator
          activities={recentActivities}
          maxItems={3}
          users={usersById}
        />
      </div>
    </CollaborationSurface>
  ),
  play: async ({ canvas }) => {
    // Presence rail — visible roster.
    await expect(
      canvas.getByRole("list", { name: "Collaborators" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("img", { name: "Pikachu, active" }),
    ).toBeVisible();

    // Peer cursors anchored over the prose.
    await expect(
      canvas.getByRole("img", { name: "Pikachu cursor" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("img", { name: "Bulbasaur cursor" }),
    ).toBeVisible();

    // Selection range belongs to Charmander and is labelled.
    await expect(
      canvas.getByRole("img", {
        name: "Charmander selection: Collaborative editing keeps",
      }),
    ).toBeVisible();

    // Per-block badge aggregates everyone in this block.
    await expect(canvas.getByLabelText("3 people editing here")).toBeVisible();

    // Recent activity log.
    await expect(
      canvas.getByLabelText("Recent collaboration activity"),
    ).toBeVisible();
  },
};

/**
 * Calm-state variant: connection is healthy (so the indicator hides per
 * design doc §2.1) and only a single trainer is actively editing. Useful
 * for a Chromatic baseline of the quiet UX.
 */
export const SoloEditor: Story = {
  render: () => {
    const lonelyEditor: PresenceUser = {
      ...squirtle,
      cursor: { blockId: SHARED_BLOCK_ID, offset: 24 },
    };
    return (
      <CollaborationSurface>
        <div style={overlayLayerStyle}>
          <div style={topRailStyle}>
            <PresenceBar
              maxVisible={5}
              users={[lonelyEditor, { ...pikachu, status: "offline" }]}
            />
            <ConnectionIndicator state="connected" />
          </div>
          <LiveCursor
            labelVisibleMs={60_000}
            point={{ x: 220, y: 118 }}
            user={lonelyEditor}
            viewport="none"
          />
          <div style={blockBadgePositionStyle}>
            <BlockActivityIndicator
              blockId={SHARED_BLOCK_ID}
              users={[lonelyEditor]}
            />
          </div>
        </div>
      </CollaborationSurface>
    );
  },
  play: async ({ canvas }) => {
    // Healthy connection collapses the indicator to null.
    await expect(canvas.queryByRole("status", { name: /Live/i })).toBeNull();
    // Single editor → singular label.
    await expect(
      canvas.getByLabelText("Squirtle is editing this block"),
    ).toBeVisible();
  },
};
