"use client";

import Link from "next/link";
import { useTransition } from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { cn } from "@softmaple/ui/lib/utils";
import { ErrorPaper } from "@/components/ErrorPaper";
import type { RouteErrorBoundaryProps } from "@/components/RouteError";
import { homeMaple } from "./home-styles";
import { paperSerif, paperSurface } from "./workspace-paper-styles";

/** Route error for the paper surfaces: the workspace index, home and settings. */
export function WorkspaceRouteError({
  backHref,
  backLabel,
  className,
  description,
  retry,
  title,
}: RouteErrorBoundaryProps & {
  readonly backHref: string;
  readonly backLabel: string;
  readonly className?: string;
  readonly description: string;
  readonly title: string;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <main
      className={cn(
        paperSurface,
        "relative isolate grid min-h-dvh place-items-center overflow-hidden px-6 py-12 sm:px-8",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          homeMaple,
          "pointer-events-none absolute -right-28 -top-28 -z-1 size-[440px] opacity-15 max-sm:hidden dark:opacity-25",
        )}
      />
      <section
        aria-labelledby="route-error-title"
        className="flex w-full max-w-lg flex-col items-center text-center"
      >
        <ErrorPaper className="w-[180px] sm:w-[220px]" />
        <div role="alert">
          <h1
            id="route-error-title"
            className={cn(
              paperSerif,
              "mt-2 text-[32px] leading-tight tracking-tight sm:text-4xl",
            )}
          >
            {title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            {description}
          </p>
        </div>
        <div className="mt-7 flex w-full max-w-[280px] flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
          <Button
            type="button"
            className="h-11 sm:min-w-36"
            disabled={isPending}
            aria-busy={isPending}
            onClick={() => startTransition(retry)}
          >
            <RotateCcw data-icon="inline-start" />
            {isPending ? "Trying again…" : "Try again"}
          </Button>
          <Button asChild variant="outline" className="h-11 sm:min-w-36">
            <Link href={backHref}>
              <ArrowLeft data-icon="inline-start" />
              {backLabel}
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
