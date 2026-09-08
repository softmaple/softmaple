import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { expect } from "storybook/test";

import { PresenceAvatar } from "../components/presence-avatar";
import type { PresenceUser } from "../types/presence";
import {
  bulbasaur,
  charmander,
  eevee,
  pikachu,
  pokemonFlavor,
} from "./awareness-fixtures";
import { StoryShowcase } from "./story-layout";

const sizesRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 32,
  padding: "12px 4px",
};

const sizeCellStyle: CSSProperties = {
  display: "grid",
  justifyItems: "center",
  gap: 8,
};

const sizeCaptionStyle: CSSProperties = {
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "color-mix(in srgb, CanvasText 56%, transparent)",
};

const typeChipStyle = (accent: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 8px",
  borderRadius: 999,
  background: `color-mix(in srgb, ${accent} 18%, Canvas)`,
  border: `1px solid color-mix(in srgb, ${accent} 48%, transparent)`,
  color: `color-mix(in srgb, ${accent} 30%, CanvasText)`,
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.04em",
});

const meta = {
  title: "Awareness/PresenceAvatar",
  component: PresenceAvatar,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    user: pikachu,
  },
  render: (args) => (
    <StoryShowcase
      eyebrow="Pokédex · Avatar"
      subtitle="A single trainer's avatar with a color tint, static status dot, and resilient image fallback."
      title="Trainer avatar"
    >
      <PresenceAvatar {...args} />
    </StoryShowcase>
  ),
} satisfies Meta<typeof PresenceAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
  play: async ({ canvas }) => {
    const avatar = canvas.getByRole("img", { name: "Pikachu, active" });

    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveClass("awareness-avatar--active");
    await expect(avatar).toHaveStyle({ "--awareness-user-color": "#854d0e" });
  },
};

export const Idle: Story = {
  args: {
    user: charmander,
  },
  play: async ({ canvas }) => {
    const avatar = canvas.getByRole("img", {
      name: "Charmander, idle",
    });

    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveClass("awareness-avatar--idle");
  },
};

export const OfflineWithoutStatus: Story = {
  args: {
    showStatus: false,
    user: eevee,
  },
  play: async ({ canvas }) => {
    const avatar = canvas.getByRole("img", { name: "Eevee, offline" });

    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveClass("awareness-avatar--offline");
    await expect(avatar.querySelector(".awareness-avatar__status")).toBeNull();
  },
};

// Covers the initials fallback path when a user has no avatarUrl.
const trainerWithoutSprite: PresenceUser = {
  userId: "professor-oak",
  connectionId: "professor-oak",
  name: "Professor Oak",
  color: "#7c3aed",
  status: "active",
  lastActivityAt: Date.UTC(2026, 4, 10, 9, 30, 5),
  lastSeenAt: Date.UTC(2026, 4, 10, 9, 30, 5),
  clock: 0,
};

export const InitialsFallback: Story = {
  args: {
    user: trainerWithoutSprite,
  },
  play: async ({ canvas }) => {
    const avatar = canvas.getByRole("img", { name: "Professor Oak, active" });

    await expect(avatar).toBeVisible();
    await expect(canvas.getByText("PO")).toBeVisible();
    await expect(avatar.querySelector(".awareness-avatar__image")).toBeNull();
  },
};

export const Sizes: Story = {
  render: () => (
    <StoryShowcase
      eyebrow="Pokédex · Avatar"
      subtitle="Sm, md, and lg sizes scale crisply against pixel-art and high-resolution sprites alike."
      title="Avatar size scale"
    >
      <div style={sizesRowStyle}>
        <div style={sizeCellStyle}>
          <PresenceAvatar size="sm" user={pikachu} />
          <span style={typeChipStyle(pokemonFlavor.pikachu.accent)}>
            {pokemonFlavor.pikachu.type}
          </span>
          <span style={sizeCaptionStyle}>sm · 24</span>
        </div>
        <div style={sizeCellStyle}>
          <PresenceAvatar size="md" user={bulbasaur} />
          <span style={typeChipStyle(pokemonFlavor.bulbasaur.accent)}>
            {pokemonFlavor.bulbasaur.type}
          </span>
          <span style={sizeCaptionStyle}>md · 32</span>
        </div>
        <div style={sizeCellStyle}>
          <PresenceAvatar size="lg" user={charmander} />
          <span style={typeChipStyle(pokemonFlavor.charmander.accent)}>
            {pokemonFlavor.charmander.type}
          </span>
          <span style={sizeCaptionStyle}>lg · 40</span>
        </div>
      </div>
    </StoryShowcase>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Pikachu, active" }),
    ).toHaveClass("awareness-avatar--sm");
    await expect(
      canvas.getByRole("img", { name: "Bulbasaur, active" }),
    ).toHaveClass("awareness-avatar--md");
    await expect(
      canvas.getByRole("img", { name: "Charmander, idle" }),
    ).toHaveClass("awareness-avatar--lg");
  },
};

export const UnavailableImage: Story = {
  args: {
    user: {
      ...trainerWithoutSprite,
      avatarUrl: "data:image/png;base64,broken",
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("PO")).toBeVisible();
  },
};
