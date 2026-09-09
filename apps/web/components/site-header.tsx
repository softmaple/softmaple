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
import { SoftmapleLeaf, SoftmapleWordmark } from "@/components/BrandMark";
import { ModeToggle } from "@/components/mode-toggle";

const links = [
  { label: "Playground", href: SITE_CONFIG.PLAYGROUND },
  { label: "Docs", href: SITE_CONFIG.DOCS },
  { label: "GitHub", href: SITE_CONFIG.GITHUB_REPO },
];

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
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div className="relative mx-auto flex h-16 max-w-[88rem] items-center gap-3 px-5 sm:px-8">
        <Link
          href="/"
          aria-label="Softmaple home"
          className="flex items-center gap-2"
        >
          <SoftmapleLeaf className="size-7" />
          <SoftmapleWordmark className="text-2xl" />
        </Link>
        <nav
          aria-label="Main navigation"
          className="ml-10 hidden items-center gap-7 text-sm text-muted-foreground md:flex lg:absolute lg:left-1/2 lg:ml-0 lg:-translate-x-1/2 lg:gap-9"
        >
          {links.map((link) => (
            <a
              className="transition-colors hover:text-foreground"
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
                className="md:hidden"
                size="icon"
                variant="outline"
                aria-label="Open navigation"
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
                    variant="ghost"
                    className="h-11 justify-between px-3 text-base"
                    key={link.label}
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
