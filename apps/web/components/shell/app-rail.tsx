"use client";

import Link from "next/link";
import type { FC, ReactNode } from "react";
import { cn } from "@softmaple/ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@softmaple/ui/components/tooltip";

/**
 * The 64px desktop rail.
 *
 * It holds destinations that exist regardless of which document is open, so it
 * never changes width or contents while you write. Labels live in tooltips and
 * in `aria-label`, never only in an icon.
 */

export type RailItem = {
  readonly current?: boolean;
  readonly href: string;
  readonly icon: ReactNode;
  readonly label: string;
  /** Admin routes that must not be speculatively prefetched. */
  readonly prefetch?: false;
};

export type AppRailProps = {
  readonly brand: ReactNode;
  readonly footer?: ReactNode;
  readonly items: ReadonlyArray<RailItem>;
  readonly label?: string;
};

export const AppRail: FC<AppRailProps> = ({
  brand,
  footer,
  items,
  label = "Workspace destinations",
}) => (
  <nav
    aria-label={label}
    className="app-rail hidden w-rail shrink-0 flex-col items-center gap-2 border-r border-divider bg-workspace py-4 md:flex"
  >
    <div className="mb-2 grid size-10 place-items-center">{brand}</div>
    {items.map((item) => (
      <Tooltip key={item.href}>
        <TooltipTrigger asChild>
          <Link
            aria-current={item.current === true ? "page" : undefined}
            aria-label={item.label}
            className={cn(
              "grid size-11 place-items-center rounded-lg text-content-secondary transition-colors",
              "hover:bg-quiet hover:text-content",
              item.current === true && "bg-quiet text-content",
            )}
            href={item.href}
            prefetch={item.prefetch}
          >
            {item.icon}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    ))}
    {footer !== undefined ? (
      <div className="mt-auto flex flex-col items-center gap-2">{footer}</div>
    ) : null}
  </nav>
);
