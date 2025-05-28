"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { Button } from "@softmaple/ui/components/button";
import { ModeToggle } from "@/components/mode-toggle";

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
          <Link
            href="#features"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Features
          </Link>
          <Link
            href="#docs"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Docs
          </Link>
          <Link
            href="#pricing"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Pricing
          </Link>
        </nav>

        <div className="flex items-center space-x-4">
          <ModeToggle />

          <Button variant="ghost" size="sm" className="hidden md:flex">
            Sign In
          </Button>
        </div>
      </div>
    </header>
  );
};
