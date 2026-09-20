import { cn } from "@softmaple/ui/lib/utils";
import { paperBrandTheme } from "@/components/brand-theme";
import { MapleMark } from "@/components/landing/Brand";

/** Shared route Suspense fallback: no hydration, timers, or synthetic route progress. */
export function RouteLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading"
      className={cn(
        paperBrandTheme,
        "relative isolate grid min-h-dvh grid-rows-[minmax(min-content,1fr)_var(--loading-ribbon-height)] overflow-clip bg-(--paper) text-(--ink)",
        "pt-[max(24px,env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)] [@media(max-height:600px)]:pt-[max(12px,env(safe-area-inset-top))]",
        "[--loading-ribbon-height:clamp(110px,23dvh,240px)] sm:[--loading-ribbon-height:clamp(160px,27dvh,360px)] lg:[--loading-ribbon-height:30dvh] [@media(max-height:600px)]:[--loading-ribbon-height:18dvh]",
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -left-12 -top-16 h-[240px] w-[260px] rotate-155 opacity-25 sm:-left-16 sm:-top-24 sm:h-[360px] sm:w-[390px] lg:h-[410px] lg:w-[440px]",
          "bg-[url('/landing/veined-maple.webp')] bg-contain bg-center bg-no-repeat dark:bg-[url('/auth/veined-maple-dark.webp')]",
          "[@media(max-width:360px)]:hidden [@media(max-height:600px)]:opacity-15",
        )}
      />

      <div className="relative z-10 flex flex-col items-center self-center px-6 pt-6 pb-10 text-center [@media(max-height:600px)]:pt-3 [@media(max-height:600px)]:pb-6">
        <div className="h-12 w-11 [&_svg]:size-full [@media(max-height:600px)]:h-8 [@media(max-height:600px)]:w-7">
          <MapleMark />
        </div>
        <p className="mt-2 text-[42px] leading-none tracking-[-0.055em] [font-family:Georgia,_'Times_New_Roman',_serif] sm:text-[48px] [@media(max-height:600px)]:text-[34px]">
          softmaple
        </p>

        <div className="mt-10 font-mono text-[15px] leading-[1.85] tracking-[0.025em] text-(--muted-ink) sm:text-[18px] [@media(max-height:600px)]:mt-5 [@media(max-height:600px)]:text-[14px]">
          <p>A little thought.</p>
          <p className="relative isolate whitespace-nowrap text-(--ink)">
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute -inset-x-5 -inset-y-1 -z-10 -rotate-2 opacity-65 dark:opacity-30",
                "bg-[url('/loading/brush.svg')] bg-size-[100%_100%] bg-center bg-no-repeat",
                "motion-safe:animate-[loading-paint_760ms_400ms_cubic-bezier(0.25,0.46,0.45,0.94)_both] motion-reduce:[clip-path:none]",
              )}
            />
            A shared beginning.
          </p>
        </div>

        <div className="mt-12 w-[min(17rem,70vw)] [@media(max-height:600px)]:mt-6">
          <div
            aria-hidden="true"
            className="h-[5px] overflow-hidden rounded-full bg-(--line)/50"
          >
            <span className="block h-full w-[38%] rounded-full bg-(--brand-gold) motion-safe:animate-[loading-travel_2400ms_ease-in-out_infinite] motion-reduce:translate-x-[82%]" />
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
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-(--loading-ribbon-height)",
          "bg-[url('/auth/paper-login-cutout.webp')] bg-cover bg-position-[center_43%] bg-no-repeat dark:bg-[url('/auth/paper-login-dark.webp')]",
          "sm:bg-size-[100%_180%] sm:bg-position-[center_40%] [mask-image:linear-gradient(to_bottom,transparent,#000_18%)]",
        )}
      />
    </main>
  );
}
