"use client";

import type { FC, ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { cn } from "@softmaple/ui/lib/utils";

/**
 * The optional 240–280px navigator beside the rail.
 *
 * Collapsing it is the first thing that gives way when width runs short, so
 * the document keeps its measure. It is a *disclosure*, not a route: closing
 * it never navigates and never unmounts what is to its right.
 */

export type AppNavigatorProps = {
  readonly children: ReactNode;
  readonly expanded: boolean;
  readonly header?: ReactNode;
  readonly label?: string;
  readonly onExpandedChange: (expanded: boolean) => void;
};

export const AppNavigator: FC<AppNavigatorProps> = ({
  children,
  expanded,
  header,
  label = "Workspace navigator",
  onExpandedChange,
}) => (
  <div className="hidden md:flex">
    {expanded ? (
      <aside
        aria-label={label}
        className={cn(
          "app-navigator flex w-navigator shrink-0 flex-col gap-3 border-r border-divider",
          "bg-workspace p-3 xl:w-[17.5rem]",
        )}
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{header}</div>
          <Button
            aria-expanded
            aria-label="Collapse navigator"
            onClick={() => onExpandedChange(false)}
            size="icon-sm"
            variant="ghost"
          >
            <PanelLeftClose />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    ) : (
      <div className="flex w-11 shrink-0 flex-col items-center border-r border-divider bg-workspace py-3">
        <Button
          aria-expanded={false}
          aria-label="Expand navigator"
          onClick={() => onExpandedChange(true)}
          size="icon-sm"
          variant="ghost"
        >
          <PanelLeftOpen />
        </Button>
      </div>
    )}
  </div>
);
