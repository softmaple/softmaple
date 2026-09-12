"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Menu } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@softmaple/ui/components/sheet";
import { SITE_CONFIG } from "@softmaple/config";
import { SoftmapleWordmark } from "@/components/BrandMark";
import { ModeToggle } from "@/components/mode-toggle";

const links = [
  { label: "Playground", href: SITE_CONFIG.PLAYGROUND },
  { label: "Docs", href: SITE_CONFIG.DOCS },
  { label: "GitHub", href: SITE_CONFIG.GITHUB_REPO },
];

/**
 * The header carries no surface over the hero and grows one as the reader
 * leaves it. That reaction is a scroll-driven CSS animation on
 * `.site-header::after` (see `app/design.css`) rather than a scroll listener,
 * so it costs nothing on the main thread and stays in step with a flick.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <header className="site-header">
      <div className="mx-auto flex h-18 max-w-7xl items-center gap-3 px-5 sm:px-8">
        <Link
          aria-label="Softmaple home"
          className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          href="/"
        >
          <SoftmapleWordmark className="text-2xl" />
        </Link>
        <nav
          aria-label="Main navigation"
          className="ml-12 hidden items-center gap-8 text-sm text-muted-foreground md:flex"
        >
          {links.map((link) => (
            <a
              className="stroke-link rounded-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              href={link.href}
              key={link.label}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ModeToggle />
          <Button asChild className="hidden md:inline-flex" variant="ghost">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild className="hidden md:inline-flex">
            <Link href="/signup">
              Start writing <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                aria-label="Open navigation"
                className="md:hidden"
                size="icon"
                variant="outline"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent className="gap-0" side="bottom">
              <SheetHeader className="pb-2">
                <SheetTitle>
                  <SoftmapleWordmark className="text-xl" />
                </SheetTitle>
                <SheetDescription>Your next idea starts here.</SheetDescription>
              </SheetHeader>
              <nav
                aria-label="Mobile navigation"
                className="flex flex-col gap-1 px-4"
              >
                {links.map((link) => (
                  <Button
                    asChild
                    className="h-11 justify-between px-3 text-base"
                    key={link.label}
                    variant="ghost"
                  >
                    <a href={link.href} onClick={() => setOpen(false)}>
                      {link.label}
                      <ArrowUpRight
                        className="text-muted-foreground"
                        data-icon="inline-end"
                      />
                    </a>
                  </Button>
                ))}
              </nav>
              <div className="mt-4 flex flex-col gap-3 border-t p-4">
                <Button asChild size="lg">
                  <Link href="/signup" onClick={() => setOpen(false)}>
                    Start writing <ArrowUpRight data-icon="inline-end" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/login" onClick={() => setOpen(false)}>
                    Sign in
                  </Link>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
