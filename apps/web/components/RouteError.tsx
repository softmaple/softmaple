"use client";

import Link from "next/link";
import { useTransition } from "react";
import { ArrowLeft, House, RotateCcw } from "lucide-react";
import { SITE_CONFIG } from "@softmaple/config";
import { Button } from "@softmaple/ui/components/button";
import { cn } from "@softmaple/ui/lib/utils";
import { RaspberryRecordMark } from "@/components/BrandMark";
import { paperBrandTheme } from "@/components/brand-theme";
import { LandingBrand } from "@/components/landing/Brand";
import { ErrorPaper } from "@/components/ErrorPaper";
import { PaperRibbon } from "@/components/PaperRibbon";

export type RouteErrorBoundaryProps = {
  readonly retry: () => void;
};

type ScopedRouteErrorProps = RouteErrorBoundaryProps & {
  readonly variant?: "scoped";
  readonly backHref: string;
  readonly backLabel: string;
  readonly className?: string;
  readonly description: string;
  readonly title: string;
};

export type RouteErrorProps =
  | ScopedRouteErrorProps
  | (RouteErrorBoundaryProps & {
      readonly variant: "global";
    });

const recoveryFocus =
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#967200] dark:focus-visible:outline-[#ffcc32]";

function GlobalRouteError({ retry }: RouteErrorBoundaryProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <main
      className={cn(
        paperBrandTheme,
        "relative isolate grid min-h-dvh grid-rows-[auto_minmax(min-content,1fr)_var(--error-ribbon-height)] overflow-clip bg-(--paper) text-(--ink)",
        "[--error-ribbon-height:clamp(130px,24dvh,240px)] sm:[--error-ribbon-height:clamp(180px,29dvh,360px)] lg:[--error-ribbon-height:32dvh] [@media(max-height:600px)]:[--error-ribbon-height:110px]",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-28 top-0 hidden h-[360px] w-[340px] rotate-155 bg-[url('/landing/veined-maple.webp')] bg-contain bg-center bg-no-repeat opacity-25 sm:block lg:h-[420px] lg:w-[390px] dark:bg-[url('/auth/veined-maple-dark.webp')]"
      />
      <header className="relative z-10 flex items-center justify-between gap-4 pl-[max(24px,env(safe-area-inset-left))] pr-[max(24px,env(safe-area-inset-right))] pt-[max(24px,env(safe-area-inset-top))] pb-4 sm:pl-[max(40px,env(safe-area-inset-left))] sm:pr-[max(40px,env(safe-area-inset-right))] sm:pt-8 lg:px-14">
        <Link
          href="/"
          aria-label="Softmaple home"
          className={cn(
            "rounded-sm [font-family:Georgia,_serif]",
            recoveryFocus,
          )}
        >
          <LandingBrand />
        </Link>
        <Link
          href="/"
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-sm text-sm text-(--muted-ink) hover:text-(--ink)",
            recoveryFocus,
          )}
        >
          <ArrowLeft aria-hidden="true" className="size-4" /> Go home
        </Link>
      </header>

      <section
        aria-labelledby="route-error-title"
        className="relative z-10 flex flex-col items-center self-center pl-[max(24px,env(safe-area-inset-left))] pr-[max(24px,env(safe-area-inset-right))] pt-5 pb-9 text-center sm:pt-6 sm:pb-10 [@media(max-height:600px)]:pt-0 [@media(max-height:600px)]:pb-6"
      >
        <ErrorPaper />
        <div role="alert">
          <h1
            id="route-error-title"
            className="mt-1 max-w-2xl text-[38px] leading-[1.13] font-normal tracking-[-0.045em] [font-family:Georgia,_'Times_New_Roman',_serif] sm:text-[46px] lg:text-[52px]"
          >
            Something went{" "}
            <span className="relative isolate inline-block whitespace-nowrap">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-x-5 -inset-y-2 -z-10 -rotate-2 bg-[url('/loading/brush.svg')] bg-size-[100%_100%] bg-center bg-no-repeat opacity-90 dark:opacity-45"
              />
              wrong.
            </span>
          </h1>
          <p className="mt-5 max-w-[23rem] text-[15px] leading-6 text-(--muted-ink) sm:max-w-none sm:text-base">
            An unexpected error occurred. Please try again.
          </p>
        </div>
        <div className="mt-7 flex w-full max-w-[280px] flex-col gap-3 sm:mt-8 sm:w-auto sm:max-w-none sm:flex-row">
          <Button
            type="button"
            disabled={isPending}
            aria-busy={isPending}
            onClick={() => startTransition(retry)}
            className={cn(
              "h-[52px] min-w-[154px] bg-[#ffcf32] text-[#17150d] shadow-none hover:bg-[#f4c327] active:bg-[#e9b923] disabled:opacity-60 focus-visible:ring-0 dark:bg-[#ffcb32] dark:hover:bg-[#ffd753] dark:active:bg-[#e9b923]",
              recoveryFocus,
            )}
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            {isPending ? "Trying again…" : "Try again"}
          </Button>
          <Button
            asChild
            variant="outline"
            className={cn(
              "h-[52px] min-w-[140px] border-(--line) bg-transparent text-(--ink) shadow-none hover:bg-(--surface) hover:text-(--ink) active:bg-(--line)/25 focus-visible:ring-0 dark:border-(--line) dark:bg-transparent dark:hover:bg-(--surface)",
              recoveryFocus,
            )}
          >
            <Link href="/">
              <House aria-hidden="true" className="size-4" /> Go home
            </Link>
          </Button>
        </div>
        <p className="mt-7 max-w-[280px] text-[13px] leading-6 text-(--muted-ink) sm:mt-7 sm:max-w-none">
          If the problem persists, please{" "}
          <a
            href={`mailto:${SITE_CONFIG.CONTACT_EMAIL}`}
            className={cn(
              "whitespace-nowrap rounded-sm text-(--ink) underline decoration-(--muted-ink)/60 underline-offset-2 hover:decoration-current",
              recoveryFocus,
            )}
          >
            contact support
          </a>
          .
        </p>
      </section>

      <PaperRibbon className="h-(--error-ribbon-height)" />
    </main>
  );
}

export function RouteError(props: RouteErrorProps) {
  return props.variant === "global" ? (
    <GlobalRouteError retry={props.retry} />
  ) : (
    <ScopedRouteError {...props} />
  );
}

function ScopedRouteError({
  backHref,
  backLabel,
  className,
  description,
  retry,
  title,
}: ScopedRouteErrorProps) {
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
