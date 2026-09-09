import type { ComponentProps } from "react";

import { cn } from "@softmaple/ui/lib/utils";

export function RaspberryRecordMark({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-9 shrink-0 place-items-center border bg-background",
        className,
      )}
      {...props}
    >
      <span className="size-2.5 rounded-full bg-primary" />
    </span>
  );
}

/** The soft maple leaf that opens the wordmark on public surfaces. */
export function SoftmapleLeaf({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={cn("size-6 shrink-0 text-primary", className)}
      {...props}
    >
      <path
        d="M12.6 21.2c-.2-3.4.3-6.2 1.6-8.6 1.3-2.4 3.3-4.3 6-5.7-3.3-.5-6 .1-8 1.8-2 1.7-3.2 4.3-3.5 7.7-1.1-1.6-1.9-3.4-2.3-5.4-.4-2-.4-4.2 0-6.6 2.3 1 4.2 1.8 5.6 2.6 1.4.8 2.5 1.7 3.2 2.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SoftmapleWordmark({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "font-display font-semibold tracking-[-0.025em] text-foreground",
        className,
      )}
      {...props}
    >
      softmaple<span className="text-emphasis">.</span>
    </span>
  );
}
