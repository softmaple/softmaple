import type { FC } from "react";

export interface AttentionInvitationProps {
  readonly senderName: string;
  readonly remainingSeconds: number;
  readonly pending?: boolean;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
}

/** A quiet invitation. Rendering never focuses, scrolls or selects anything. */
export const AttentionInvitation: FC<AttentionInvitationProps> = ({
  senderName,
  remainingSeconds,
  pending = false,
  onAccept,
  onDismiss,
}) => (
  <section
    className="awareness-attention-invitation"
    aria-label={`Invitation from ${senderName}`}
  >
    <output>
      <strong>{senderName}</strong> invited you to a passage{" "}
      <span>· {Math.max(0, remainingSeconds)}s</span>
    </output>
    <div>
      <button
        type="button"
        disabled={pending || remainingSeconds <= 0}
        onClick={onAccept}
      >
        Open here
      </button>
      <button type="button" disabled={pending} onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  </section>
);
