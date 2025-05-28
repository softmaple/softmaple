"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/header";
import { Hero } from "@/components/hero";
import { Features } from "@/components/features";
import { Footer } from "@/components/footer";
import { CtaSection } from "@/components/cta-section";

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <Header />

      {/* Hero Section */}
      <Hero />

      {/* Features Section */}
      <Features />

      {/* CTA Section */}
      <CtaSection />

      {/* Footer */}
      <Footer />
    </div>
  );
}
