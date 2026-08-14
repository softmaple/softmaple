"use client";

import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { cn } from "@softmaple/ui/lib/utils";
import { RaspberryRecordMark } from "@/components/BrandMark";

export type RouteErrorBoundaryProps = {
  readonly retry: () => void;
};

export type RouteErrorProps = RouteErrorBoundaryProps & {
  readonly backHref: string;
  readonly backLabel: string;
  readonly className?: string;
  readonly description: string;
  readonly title: string;
};

export function RouteError({
  backHref,
  backLabel,
  className,
  description,
  retry,
  title,
}: RouteErrorProps) {
  return (
    <main
      className={cn(
        "grid min-h-0 flex-1 place-items-center overflow-y-auto bg-background px-4 py-12 sm:px-6",
        className,
      )}
    >
      <section className="w-full max-w-xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 border-b px-5 py-3">
          <RaspberryRecordMark className="size-8" />
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
            Record interrupted
          </p>
        </div>
        <div className="p-6 sm:p-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {title}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          <div className="mt-7 flex flex-wrap gap-2">
            <Button onClick={retry}>
              <RotateCcw className="size-4" />
              Try again
            </Button>
            <Button asChild variant="outline">
              <Link href={backHref}>
                <ArrowLeft className="size-4" />
                {backLabel}
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
