import { cn } from "@softmaple/ui/lib/utils";
import { paperBrandTheme } from "@/components/brand-theme";
import { MapleMark } from "@/components/landing/Brand";
import "./loading.css";

/** Root Suspense fallback: no hydration, timers, or synthetic route progress. */
export function GlobalLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading"
      className={cn(
        paperBrandTheme,
        "global-loading relative isolate grid min-h-dvh overflow-clip bg-(--paper) text-(--ink)",
      )}
    >
      <div
        aria-hidden="true"
        className="loading-maple pointer-events-none absolute -left-12 -top-16 h-[240px] w-[260px] rotate-155 opacity-25 sm:-left-16 sm:-top-24 sm:h-[360px] sm:w-[390px] lg:h-[410px] lg:w-[440px]"
      />

      <div className="loading-content relative z-10 flex flex-col items-center px-6 text-center">
        <div className="loading-logo h-12 w-11 [&_svg]:size-full">
          <MapleMark />
        </div>
        <p className="loading-wordmark mt-2 text-[42px] leading-none tracking-[-0.055em] [font-family:Georgia,_'Times_New_Roman',_serif] sm:text-[48px]">
          softmaple
        </p>

        <div className="loading-thought mt-10 font-mono text-[15px] leading-[1.85] tracking-[0.025em] text-(--muted-ink) sm:text-[18px]">
          <p>A little thought.</p>
          <p className="relative isolate whitespace-nowrap text-(--ink)">
            <span
              aria-hidden="true"
              className="loading-brush pointer-events-none absolute -inset-x-5 -inset-y-1 -z-10 -rotate-2 opacity-65 dark:opacity-30"
            />
            A shared beginning.
          </p>
        </div>

        <div className="loading-status mt-12 w-[min(17rem,70vw)]">
          <div
            aria-hidden="true"
            className="h-[5px] overflow-hidden rounded-full bg-(--line)/50"
          >
            <span className="loading-segment block h-full w-[38%] rounded-full bg-(--brand-gold)" />
          </div>
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="mt-5 font-mono text-xs text-(--muted-ink)"
          >
            <span className="sr-only">Loading</span>
            <span aria-hidden="true">Loading...</span>
          </p>
        </div>
      </div>

      {/* These existing cutouts include the textured paper and edge light. CSS selects
          only the current theme's asset, before hydration, without a second
          theme observer or downloading both images. */}
      <div
        aria-hidden="true"
        className="loading-ribbon pointer-events-none absolute inset-x-0 bottom-0"
      />
    </main>
  );
}
