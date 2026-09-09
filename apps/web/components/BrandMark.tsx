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
        d="M20.6 3.4c.7 5.9-.8 10.5-4.5 13.8-2.7 2.4-6 3.6-9.8 3.7-.5-4.7.7-8.5 3.6-11.5 2.9-3 6.5-5 10.7-6Z"
        fill="currentColor"
      />
      <path
        d="M4.2 21.6C7.1 15.9 11.7 11 18.1 6.9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
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
