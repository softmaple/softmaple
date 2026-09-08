"use client";

import { X } from "lucide-react";
import type { FC, ReactNode } from "react";
import { Button } from "@softmaple/ui/components/button";
import { cn } from "@softmaple/ui/lib/utils";

/**
 * The right-hand slot that shared context, outline and "People and activity"
 * take turns occupying.
 *
 * There is exactly one slot, and it is a sibling of the editor rather than a
 * wrapper around it: opening or closing it must never disturb the editor's
 * DOM. It is hidden below the split threshold, where the mobile sheet takes
 * over instead.
 */

export type ContextSlotProps = {
  readonly children: ReactNode;
  readonly onClose?: () => void;
  readonly open: boolean;
  readonly title: string;
  /** Minimum width the slot claims; the editor keeps the rest. */
  readonly width?: "narrow" | "wide";
};

export const ContextSlot: FC<ContextSlotProps> = ({
  children,
  onClose,
  open,
  title,
  width = "narrow",
}) => (
  <aside
    aria-label={title}
    className={cn(
      "hidden min-h-0 shrink-0 flex-col border-l border-divider bg-workspace lg:flex",
      width === "narrow" ? "w-80" : "w-[26rem]",
    )}
    hidden={!open}
  >
    <div className="flex h-doc-header shrink-0 items-center gap-2 border-b border-divider px-3">
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
      {onClose !== undefined ? (
        <Button
          aria-label={`Close ${title}`}
          onClick={onClose}
          size="icon-sm"
          variant="ghost"
        >
          <X />
        </Button>
      ) : null}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
  </aside>
);
