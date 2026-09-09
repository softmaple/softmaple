import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";
import { AttentionInvitation } from "../components/attention-invitation";

const meta = {
  title: "Awareness/AttentionInvitation",
  component: AttentionInvitation,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  args: {
    senderName: "Lina",
    remainingSeconds: 24,
    onAccept: fn(),
    onDismiss: fn(),
  },
} satisfies Meta<typeof AttentionInvitation>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ArrivesQuietly: Story = {
  play: async ({ canvas, args }) => {
    const accept = canvas.getByRole("button", { name: "Open here" });
    await expect(accept).not.toHaveFocus();
    await userEvent.click(accept);
    await expect(args.onAccept).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole("button", { name: "Dismiss" }));
    await expect(args.onDismiss).toHaveBeenCalledOnce();
  },
};
export const Expired: Story = {
  args: { remainingSeconds: 0 },
  play: async ({ canvas, args }) => {
    await expect(
      canvas.getByRole("button", { name: "Open here" }),
    ).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Dismiss" }));
    await expect(args.onDismiss).toHaveBeenCalledOnce();
  },
};
export const Pending: Story = {
  args: { pending: true },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Open here" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Dismiss" }),
    ).toBeDisabled();
  },
};
