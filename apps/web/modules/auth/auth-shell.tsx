import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Home } from "lucide-react";
import { SoftmapleWordmark } from "@/components/BrandMark";
import { AuthBrandSpecimen } from "@/modules/auth/auth-brand-specimen";

/** Entrance ordering for the brand column, mirroring the landing hero. */
const enterStep = (step: number): CSSProperties =>
  ({ "--enter-step": step }) as CSSProperties;

export type AuthShellProps = {
  readonly children: ReactNode;
  readonly description: string;
  readonly title: string;
};

export const AuthShell = ({ children, description, title }: AuthShellProps) => (
  <main className="min-h-dvh bg-background text-foreground">
    <div className="mx-auto grid min-h-dvh w-full max-w-[96rem] lg:grid-cols-[minmax(0,1.08fr)_minmax(27rem,0.92fr)] lg:border-x">
      <section className="hidden min-w-0 flex-col px-5 py-6 sm:px-8 lg:flex lg:min-h-dvh lg:px-12 lg:py-8 xl:px-16">
        <div className="flex items-center justify-between gap-4">
          <Link
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/"
          >
            <SoftmapleWordmark className="text-xl font-bold" />
          </Link>
          <Link
            className="inline-flex items-center gap-2 rounded-sm px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/"
          >
            <Home className="size-4" /> Back home
          </Link>
        </div>

        <div className="flex flex-1 flex-col justify-center py-12 sm:py-16 lg:py-12">
          <div
            className="h-px w-12 bg-primary"
            data-enter
            style={enterStep(0)}
          />
          <p
            className="eyebrow eyebrow-maple mt-8"
            data-enter
            style={enterStep(1)}
          >
            A shared space for your words
          </p>
          <p
            className="mt-10 max-w-3xl font-display text-[clamp(2.75rem,10vw,5.25rem)] font-semibold leading-[0.9] tracking-[-0.045em]"
            data-enter
            style={enterStep(2)}
          >
            A little space.
            <br />
            For big ideas.
          </p>
          <p
            className="prose-editorial mt-8 hidden max-w-[42ch] text-muted-foreground lg:block"
            data-enter
            style={enterStep(3)}
          >
            From the first rough note to the typeset paper. Write together, read
            it four ways, and let the format fall into place.
          </p>
          <AuthBrandSpecimen />
        </div>
      </section>

      <section className="flex min-h-dvh min-w-0 items-center bg-card px-5 py-10 sm:px-8 sm:py-14 lg:border-l lg:px-12 xl:px-16">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="mb-10 inline-flex lg:hidden">
            <SoftmapleWordmark className="text-2xl" />
          </Link>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
            {description}
          </p>
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </div>
  </main>
);
