import Link from "next/link";
import { ArrowUpLeft } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { SoftmapleWordmark } from "@/components/BrandMark";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-workspace p-6">
      <section className="w-full max-w-lg rounded-xl border bg-surface p-8 sm:p-12">
        <SoftmapleWordmark className="text-xl" />
        <p className="mb-5 mt-16 font-mono text-xs text-emphasis">
          404 / A missing place
        </p>
        <h1 className="text-3xl font-medium tracking-tight">
          This page could not be found.
        </h1>
        <p className="mb-8 mt-4 text-sm leading-7 text-muted-foreground">
          The link may have changed, or this space may not be available to your
          account.
        </p>
        <Button asChild>
          <Link href="/dashboard">
            <ArrowUpLeft />
            Back to your workspaces
          </Link>
        </Button>
      </section>
    </main>
  );
}
