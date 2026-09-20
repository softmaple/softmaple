import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LandingBrand } from "@/components/landing/Brand";
import { cn } from "@softmaple/ui/lib/utils";
import { AuthBrandPanel } from "./auth-brand-panel";
import { authLinkClass } from "./auth-styles";

export function AuthPageShell({
  children,
  mode,
  title,
  description,
}: {
  readonly children: ReactNode;
  readonly mode: "login" | "signup";
  readonly title: string;
  readonly description: string;
}) {
  return (
    <main
      className={cn(
        "relative isolate min-h-dvh overflow-clip bg-(--paper) text-(--ink) [font-family:var(--font-body),_Arial,_sans-serif]",
        "[--paper:#faf9f6] [--ink:#0c0c0b] [--muted-ink:#62656b] [--line:#cccdd0] [--surface:#f3f3f1] [--brand-gold:#ffc800]",
        "dark:[--paper:#201e1a] dark:[--ink:#f7f2e8] dark:[--muted-ink:#b9b8b5] dark:[--line:#5c5952] dark:[--surface:#191815] dark:[--brand-gold:#ffcc32]",
      )}
    >
      <div className="relative mx-auto flex min-h-dvh max-w-[1536px] flex-col min-[56.25rem]:min-h-[max(100dvh,calc(min(100vw,1536px)*0.76))] min-[56.25rem]:dark:bg-[linear-gradient(90deg,#191815_56%,#201e1a_56%)]">
        <header className="relative z-10 flex items-center justify-between gap-4 px-6 py-7 sm:px-10 min-[56.25rem]:px-[3.8%] min-[56.25rem]:py-[2.8%]">
          <Link
            href="/"
            aria-label="Softmaple home"
            className="rounded-sm [font-family:Georgia,_serif] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#967200]"
          >
            <LandingBrand />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-sm text-xs text-(--muted-ink) hover:text-(--ink) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#967200] sm:text-sm"
          >
            <ArrowLeft aria-hidden="true" className="size-4" /> Return home
          </Link>
        </header>

        <div className="grid flex-1 min-[56.25rem]:grid-cols-[56%_44%] min-[56.25rem]:min-h-[540px] xl:min-h-[640px]">
          <AuthBrandPanel mode={mode} />

          <section
            aria-labelledby="auth-title"
            className="relative z-10 flex min-w-0 items-start px-6 pb-12 pt-8 sm:px-10 sm:pt-14 min-[56.25rem]:pl-[13%] min-[56.25rem]:pr-[9.4%] min-[56.25rem]:pt-[10%] min-[56.25rem]:pb-8 xl:pt-[8%]"
          >
            <div className="mx-auto w-full max-w-[440px]">
              <h1
                id="auth-title"
                className="text-[34px] font-normal leading-tight tracking-[-0.045em] [font-family:Georgia,_'Times_New_Roman',_serif] sm:text-[40px] min-[56.25rem]:text-[clamp(30px,3.16vw,44px)]"
              >
                {title}
              </h1>
              <p className="mt-2 text-sm leading-6 text-(--muted-ink) sm:text-base min-[56.25rem]:max-xl:text-sm min-[56.25rem]:max-xl:leading-5">
                {description}
              </p>
              <div className="mt-6 min-[56.25rem]:max-xl:mt-2">{children}</div>
            </div>
          </section>
        </div>

        <footer className="relative z-10 flex flex-wrap items-center justify-between gap-4 px-6 py-7 text-[11px] text-(--muted-ink) sm:px-10 lg:px-14 min-[56.25rem]:max-xl:py-5">
          <p>© {new Date().getFullYear()} Softmaple</p>
          <nav aria-label="Legal" className="flex gap-6">
            <Link className={authLinkClass} href="/privacy" prefetch={false}>
              Privacy
            </Link>
            <Link className={authLinkClass} href="/terms" prefetch={false}>
              Terms
            </Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}
