"use client";

import { cn } from "@softmaple/ui/lib/utils";
import { iconButtonClasses, primaryClasses } from "./primitives";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { SITE_CONFIG } from "@softmaple/config";
import { LandingBrand } from "./Brand";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@softmaple/ui/components/sheet";
import { paperBrandTheme } from "@/components/brand-theme";

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  useEffect(() => {
    const media = matchMedia("(min-width: 768px)");
    const close = () => setOpen(false);
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  return (
    <header
      className={cn(
        "relative z-5 w-[90%] max-w-[1320px] m-auto h-22 flex items-center justify-between gap-6",
        "max-[1200px]:gap-[18px] max-[1200px]:h-20",
        "min-[768px]:max-[1024px]:w-[93%] min-[768px]:max-[1024px]:gap-3",
        "max-[768px]:h-[78px] max-[768px]:w-[calc(100%_-_40px)] max-[768px]:gap-2",
      )}
    >
      <Link href="/" aria-label="Softmaple home">
        <LandingBrand />
      </Link>
      <nav
        className={cn(
          "flex items-center gap-[38px] text-(--muted-ink) text-[16px] [&_a]:[transition:color_160ms]",
          "[&_a:hover]:text-(--ink) [&_a:hover]:underline [&_a:hover]:underline-offset-[5px]",
          "max-[1200px]:gap-[22px] max-[1200px]:text-[13px]",
          "min-[768px]:max-[1024px]:gap-[18px] min-[768px]:max-[1024px]:text-[12px]",
          "max-[768px]:hidden",
        )}
        aria-label="Main navigation"
      >
        <a href="#product">Product</a>
        <a href="#collaboration">Collaboration</a>
        <a href={SITE_CONFIG.GITHUB_REPO}>Open source</a>
      </nav>
      <div className="flex items-center gap-6 max-[1200px]:gap-3.5 min-[768px]:max-[1024px]:gap-2 max-[768px]:gap-0.5">
        <button
          className={iconButtonClasses}
          type="button"
          aria-label="Toggle color theme"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="dark:hidden" aria-hidden="true" />
          <Moon className="hidden dark:block" aria-hidden="true" />
        </button>
        <Link
          className={cn(
            "[transition:color_160ms] hover:text-(--ink) hover:underline hover:underline-offset-[5px] text-(--muted-ink)",
            "text-[16px]",
            "min-[768px]:max-[1024px]:text-[13px]",
            "max-[768px]:hidden",
          )}
          href="/login"
        >
          Log in
        </Link>
        <Link
          className={cn(
            primaryClasses,
            "min-h-[58px] py-0 px-7 text-[18px]",
            "max-[1200px]:min-h-[50px] max-[1200px]:text-[16px] max-[1200px]:py-0 max-[1200px]:px-[22px]",
            "min-[768px]:max-[1024px]:py-0 min-[768px]:max-[1024px]:px-4 min-[768px]:max-[1024px]:text-[14px]",
            "max-[768px]:hidden",
            "leading-[1.2]",
          )}
          href="/signup"
        >
          Start writing
        </Link>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              className={cn(
                iconButtonClasses,
                "hidden max-[768px]:inline-grid",
              )}
              type="button"
              aria-label="Open navigation"
            >
              <Menu aria-hidden="true" />
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className={cn(
              paperBrandTheme,
              "gap-0 bg-(--paper) text-(--ink) [font-family:var(--font-body),_Arial,_sans-serif]",
              "[&_a]:rounded-md [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-offset-2 [&_a]:focus-visible:outline-[#967200]",
            )}
          >
            <SheetHeader>
              <SheetTitle className="text-(--ink)">
                Explore Softmaple
              </SheetTitle>
              <SheetDescription className="text-(--muted-ink)">
                A thoughtful space to write together.
              </SheetDescription>
            </SheetHeader>
            <nav
              aria-label="Main navigation"
              className="flex flex-col px-4 pb-4 [&_a]:flex [&_a]:min-h-12 [&_a]:items-center [&_a]:px-3 [&_a]:text-base [&_a]:hover:bg-(--surface) [&_a]:active:bg-(--surface)"
            >
              <a href="#product" onClick={() => setOpen(false)}>
                Product
              </a>
              <a href="#collaboration" onClick={() => setOpen(false)}>
                Collaboration
              </a>
              <a href={SITE_CONFIG.GITHUB_REPO} onClick={() => setOpen(false)}>
                Open source
              </a>
              <Link href="/login" onClick={() => setOpen(false)}>
                Log in
              </Link>
              <Link
                href="/signup"
                onClick={() => setOpen(false)}
                className="mt-3 justify-center bg-[#ffcf32] font-semibold text-[#17150d] hover:bg-[#f4c327]! active:bg-[#f4c327]!"
              >
                Start writing
              </Link>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
