import Link from "next/link";
import { SITE_CONFIG } from "@softmaple/config";
import { SoftmapleWordmark } from "@/components/BrandMark";
import { Paper } from "@/components/paper/paper";

/**
 * The landing page is not a page about Softmaple. It is a Softmaple document —
 * a working paper, open in the product, with the product's own toolbar above
 * it and its own three views of itself. See `components/paper/paper.tsx`.
 */
export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:z-[60] focus:m-3 focus:rounded-sm focus:bg-card focus:px-4 focus:py-3 focus:shadow-lg"
        href="#main"
      >
        Skip to the document
      </a>

      <Paper />

      <footer className="border-t">
        <div className="mx-auto flex max-w-[84rem] flex-col gap-5 px-5 py-9 sm:flex-row sm:items-center">
          <Link
            aria-label="Softmaple home"
            className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            href="/"
          >
            <SoftmapleWordmark className="text-lg" />
          </Link>
          <span className="font-mono text-[11px] text-muted-foreground">
            © {new Date().getFullYear()} Softmaple
          </span>
          <nav
            aria-label="Footer"
            className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground sm:ml-auto"
          >
            <a
              className="stroke-link hover:text-foreground"
              href={SITE_CONFIG.PLAYGROUND}
            >
              Playground
            </a>
            <a
              className="stroke-link hover:text-foreground"
              href={SITE_CONFIG.DOCS}
            >
              Docs
            </a>
            <a
              className="stroke-link hover:text-foreground"
              href={SITE_CONFIG.GITHUB_REPO}
            >
              GitHub
            </a>
            <a
              className="stroke-link hover:text-foreground"
              href={`mailto:${SITE_CONFIG.CONTACT_EMAIL}`}
            >
              Say hello
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
