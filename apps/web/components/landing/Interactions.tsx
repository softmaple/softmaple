"use client";

import { cn } from "@softmaple/ui/lib/utils";
import { iconButtonClasses, primaryClasses } from "./primitives";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { SITE_CONFIG } from "@softmaple/config";
import { LandingBrand } from "./Brand";

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const menuButton = useRef<HTMLButtonElement>(null);
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
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          menuButton.current?.focus();
        }
      }}
    >
      <Link href="/" aria-label="Softmaple home">
        <LandingBrand />
      </Link>
      <nav
        id="landing-navigation"
        className={cn(
          "flex items-center gap-[38px] text-(--muted-ink) text-[16px] [&_a]:[transition:color_160ms]",
          "[&_a:hover]:text-(--ink) [&_a:hover]:underline [&_a:hover]:underline-offset-[5px]",
          "max-[1200px]:gap-[22px] max-[1200px]:text-[13px]",
          "min-[768px]:max-[1024px]:gap-[18px] min-[768px]:max-[1024px]:text-[12px]",
          "max-[768px]:hidden max-[768px]:absolute max-[768px]:top-[70px] max-[768px]:right-0 max-[768px]:left-0",
          "max-[768px]:p-4 max-[768px]:border max-[768px]:border-(--line) max-[768px]:bg-(--surface)",
          "max-[768px]:shadow-[0_8px_20px_#0000000c] max-[768px]:rounded-[6px] max-[768px]:text-[16px]",
          "max-[768px]:[&_a]:flex max-[768px]:[&_a]:items-center max-[768px]:[&_a]:min-h-12",
          open &&
            "max-[768px]:flex max-[768px]:items-stretch max-[768px]:flex-col max-[768px]:gap-0",
        )}
        aria-label="Main navigation"
      >
        <a href="#product" onClick={() => setOpen(false)}>
          Product
        </a>
        <a href="#collaboration" onClick={() => setOpen(false)}>
          Collaboration
        </a>
        <a href={SITE_CONFIG.GITHUB_REPO}>Open source</a>
        <Link className="hidden" href="/login">
          Log in
        </Link>
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
        <button
          ref={menuButton}
          className={cn(iconButtonClasses, "hidden max-[768px]:inline-grid")}
          type="button"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="landing-navigation"
          onClick={() => setOpen(!open)}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}
