import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { Home } from "lucide-react";
import { LandingBrand } from "@/components/landing/Brand";

export type AuthShellProps = {
  readonly children: ReactNode;
  readonly description: string;
  readonly title: string;
  readonly artTitle?: ReactNode;
};

export const AuthShell = ({
  children,
  description,
  title,
  artTitle,
}: AuthShellProps) => (
  <main className="auth-page min-h-dvh overflow-hidden bg-[var(--auth-paper)] text-[var(--auth-ink)]">
    <div className="mx-auto grid min-h-dvh w-full max-w-[1440px] lg:grid-cols-[minmax(0,1.12fr)_minmax(27rem,0.88fr)]">
      <section className="auth-brand-panel relative hidden min-w-0 flex-col overflow-hidden px-8 py-7 sm:px-12 lg:flex lg:min-h-dvh xl:px-16">
        <Image
          aria-hidden="true"
          className="pointer-events-none absolute -right-[13%] top-[6%] w-[76%] max-w-[44rem] rotate-[8deg] opacity-90"
          src="/landing/paper-ribbon.webp"
          alt=""
          width={1448}
          height={1086}
          sizes="55vw"
          priority
        />
        <Image
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-10 -left-12 w-64 -rotate-12 opacity-60 xl:w-80"
          src="/landing/veined-maple.webp"
          alt=""
          width={1297}
          height={1213}
          sizes="320px"
          priority
        />
        <div className="flex items-center justify-between gap-4">
          <Link
            className="relative z-10 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#967200]"
            href="/"
          >
            <LandingBrand />
          </Link>
          <Link
            className="relative z-10 inline-flex items-center gap-2 rounded-sm px-2 py-1 text-sm text-[#5f625e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#967200]"
            href="/"
          >
            <Home className="size-4" /> Back home
          </Link>
        </div>

        <div className="relative z-10 flex flex-1 flex-col justify-center py-12 sm:py-16 lg:py-12">
          <h2 className="max-w-[38rem] font-serif text-[clamp(3.8rem,7.2vw,7.2rem)] leading-[0.9] tracking-[-0.065em] text-[#10100e]">
            {artTitle ?? <>Make room for good ideas.</>}
          </h2>
          <div
            className="mt-12 flex items-center gap-5 text-xs text-[#666862]"
            aria-hidden="true"
          >
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#a76dba]" /> Mia
            </span>
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#3d82bd]" /> Adam
            </span>
            <span className="rounded-sm bg-[#ffcc3a] px-2 py-1 text-[#4a3a05]">
              Let&apos;s build on this.
            </span>
          </div>
        </div>
      </section>

      <section className="flex min-h-dvh min-w-0 items-center px-5 py-10 sm:px-8 sm:py-14 lg:border-l lg:border-[#e9e2d5] lg:px-12 xl:px-16">
        <div className="mx-auto w-full max-w-[27rem]">
          <Link href="/" className="mb-12 inline-flex lg:hidden">
            <LandingBrand />
          </Link>
          <h1 className="font-serif text-[2.5rem] leading-[1] tracking-[-0.045em] sm:text-[3.15rem]">
            {title}
          </h1>
          <p className="mt-4 max-w-sm text-[0.98rem] leading-6 text-[#676963] sm:text-base">
            {description}
          </p>
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </div>
  </main>
);
