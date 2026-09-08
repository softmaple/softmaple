"use client";

import Link from "next/link";
import type { FC, ReactNode } from "react";
import { cn } from "@softmaple/ui/lib/utils";

/**
 * The compact-width bottom bar.
 *
 * Every target is at least 44px so it can be hit with a thumb, and the bar
 * sits above the safe-area inset so the last destination is not under the home
 * indicator. It carries the same destinations as the rail — a person moving
 * between devices should not have to learn a second map.
 */

export type MobileNavigationItem = {
  readonly current?: boolean;
  readonly href: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly prefetch?: false;
};

export type MobileNavigationProps = {
  readonly items: ReadonlyArray<MobileNavigationItem>;
  readonly label?: string;
  /** A trailing control, e.g. a sheet trigger for the document list. */
  readonly trailing?: ReactNode;
};

export const MobileNavigation: FC<MobileNavigationProps> = ({
  items,
  label = "Workspace destinations",
  trailing,
}) => (
  <nav
    aria-label={label}
    className={cn(
      "flex shrink-0 items-stretch gap-1 border-t border-divider bg-workspace px-2 md:hidden",
      "pb-[env(safe-area-inset-bottom)]",
    )}
  >
    {items.map((item) => (
      <Link
        aria-current={item.current === true ? "page" : undefined}
        className={cn(
          "flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 rounded-lg",
          "px-2 py-1.5 text-[11px] text-content-secondary",
          item.current === true && "text-content",
        )}
        href={item.href}
        key={item.href}
        prefetch={item.prefetch}
      >
        <span aria-hidden>{item.icon}</span>
        <span className="truncate">{item.label}</span>
      </Link>
    ))}
    {trailing}
  </nav>
);
