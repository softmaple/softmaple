"use client";

import type { FC, ReactNode } from "react";
import { cn } from "@softmaple/ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@softmaple/ui/components/tooltip";

/**
 * One status, stated on its own terms.
 *
 * Save durability and live connectivity are separate facts about a document
 * and are rendered by two separate indicators. Collapsing them — "offline", so
 * you cannot tell whether your last paragraph survived — is the failure this
 * primitive exists to prevent, so it deliberately renders exactly one fact and
 * has no way to express a second.
 */

export const STATUS_LEVEL = {
  /** Everything is as it should be; the quietest possible presentation. */
  Settled: "settled",
  /** Work is in flight. Not a problem, but not finished either. */
  Working: "working",
  /** Degraded, recoverable, and worth reading. */
  Caution: "caution",
  /** Something failed and there is an action to take. */
  Critical: "critical",
} as const;

export type StatusLevel = (typeof STATUS_LEVEL)[keyof typeof STATUS_LEVEL];

const DOT_CLASS: Readonly<Record<StatusLevel, string>> = {
  [STATUS_LEVEL.Settled]: "bg-positive",
  [STATUS_LEVEL.Working]: "bg-content-secondary",
  [STATUS_LEVEL.Caution]: "bg-caution",
  [STATUS_LEVEL.Critical]: "bg-critical",
};

const TEXT_CLASS: Readonly<Record<StatusLevel, string>> = {
  [STATUS_LEVEL.Settled]: "text-content-secondary",
  [STATUS_LEVEL.Working]: "text-content-secondary",
  [STATUS_LEVEL.Caution]: "text-caution",
  [STATUS_LEVEL.Critical]: "text-critical",
};

export type StatusIndicatorProps = {
  /** The recovery affordance, when the person can do something about it. */
  readonly action?: ReactNode;
  /** Full sentence for the tooltip and the accessible name. */
  readonly detail: string;
  readonly label: string;
  readonly level: StatusLevel;
  /** What this indicator is about, e.g. "Saving" or "Live collaboration". */
  readonly name: string;
};

export const StatusIndicator: FC<StatusIndicatorProps> = ({
  action,
  detail,
  label,
  level,
  name,
}) => (
  <div className="flex items-center gap-1.5">
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs",
            TEXT_CLASS[level],
          )}
          // Polite: a status change must never interrupt typing.
          aria-live="polite"
          tabIndex={0}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              DOT_CLASS[level],
              // Forced colours drop background-colour, so carry the meaning in
              // a border too.
              "forced-colors:border forced-colors:border-[CanvasText]",
            )}
          />
          <span className="sr-only">{`${name}: `}</span>
          <span className="hidden sm:inline">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
    {action}
  </div>
);
