"use client";

import { Badge } from "@softmaple/ui/components/badge";
import { ArrowRight, Zap } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import Link from "next/link";
import { SITE_CONFIG } from "@softmaple/config";

export const Hero = () => {
  return (
    <section className="container mx-auto px-4 pt-20 pb-16 md:pt-32 md:pb-24">
      <div className="max-w-4xl mx-auto text-center">
        <Badge variant="secondary" className="mb-6 px-3 py-1">
          <Zap className="w-3 h-3 mr-1" />
          Now with AI-powered suggestions
        </Badge>

        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
          Write visually,{" "}
          <span className="bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent">
            export professionally
          </span>
        </h1>

        <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
          The modern WYSIWYG editor that outputs clean LaTeX and Markdown.
          Perfect for academics, engineers, and technical writers.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Link
            href={SITE_CONFIG.PLAYGROUND}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="lg" className="px-8 py-3 text-base font-medium group">
              Try Playground
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="lg"
            className="px-8 py-3 text-base font-medium"
            asChild
          >
            <Link href={`mailto:${SITE_CONFIG.CONTACT_EMAIL}`}>
              Book a Demo
            </Link>
          </Button>
        </div>

        <p className="text-sm text-muted-foreground mt-4">
          Free to try • No credit card required
        </p>
      </div>
    </section>
  );
};
