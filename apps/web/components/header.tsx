"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { Button } from "@softmaple/ui/components/button";
import { ModeToggle } from "@/components/mode-toggle";

const navItems = [
  { key: "features", href: "#features", label: "Features" },
  { key: "docs", href: "#docs", label: "Docs" },
  { key: "pricing", href: "#pricing", label: "Pricing" },
];

export const Header = () => {
  return (
    <header className="border-b border-border/40 backdrop-blur-sm sticky top-0 z-50 bg-background/80">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <span className="font-semibold text-xl">Softmaple</span>
        </div>

        <nav className="hidden md:flex items-center space-x-8">
          {navItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center space-x-4">
          <ModeToggle />

          <Button variant="ghost" size="sm" className="flex">
            <Link href="/login">Sign In</Link>
          </Button>
        </div>
      </div>
    </header>
  );
};
