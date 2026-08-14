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
      softmaple<span className="text-primary">.</span>
    </span>
  );
}
