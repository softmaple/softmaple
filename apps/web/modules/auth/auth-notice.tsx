import type { ReactNode } from "react";
import { cn } from "@softmaple/ui/lib/utils";

/**
 * Inline auth message on the paper palette: brand gold for guidance, the
 * destructive tone for failures. Errors interrupt; guidance stays polite.
 */
export function AuthNotice({
  children,
  className,
  tone = "info",
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly tone?: "info" | "error";
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-sm border-l-2 px-3 py-2 text-sm leading-6",
        tone === "error"
          ? "border-destructive bg-destructive/10 text-destructive"
          : "border-(--brand-gold) bg-(--brand-gold)/12 text-(--ink)",
        className,
      )}
    >
      {children}
    </p>
  );
}
