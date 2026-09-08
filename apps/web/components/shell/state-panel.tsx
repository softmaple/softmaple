import type { FC, ReactNode } from "react";
import { cn } from "@softmaple/ui/lib/utils";

/**
 * Empty, pending, denied and error states.
 *
 * One component for all four so that they cannot drift apart, and so every one
 * of them is forced to answer the same three questions: what happened, what it
 * means, and what you can do next. A state with no action is allowed; a state
 * with no explanation is not.
 */

export const STATE_TONE = {
  Empty: "empty",
  Pending: "pending",
  Denied: "denied",
  Error: "error",
} as const;

export type StateTone = (typeof STATE_TONE)[keyof typeof STATE_TONE];

const TONE_CLASS: Readonly<Record<StateTone, string>> = {
  [STATE_TONE.Empty]: "text-content-secondary",
  [STATE_TONE.Pending]: "text-content-secondary",
  [STATE_TONE.Denied]: "text-caution",
  [STATE_TONE.Error]: "text-critical",
};

export type StatePanelProps = {
  readonly action?: ReactNode;
  readonly className?: string;
  /** What this means and what happens next. Required: never a bare title. */
  readonly description: ReactNode;
  readonly icon?: ReactNode;
  readonly title: string;
  readonly tone?: StateTone;
};

export const StatePanel: FC<StatePanelProps> = ({
  action,
  className,
  description,
  icon,
  title,
  tone = STATE_TONE.Empty,
}) => (
  <div
    className={cn(
      "mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-12 text-center",
      className,
    )}
    role={tone === STATE_TONE.Error ? "alert" : undefined}
  >
    {icon !== undefined ? (
      <div
        aria-hidden
        className={cn("grid size-10 place-items-center", TONE_CLASS[tone])}
      >
        {icon}
      </div>
    ) : null}
    <h2 className={cn("text-base font-medium", TONE_CLASS[tone])}>{title}</h2>
    <p className="text-sm leading-6 text-content-secondary">{description}</p>
    {action !== undefined ? <div className="mt-1">{action}</div> : null}
  </div>
);
