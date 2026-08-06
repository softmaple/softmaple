import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

interface DemoPageShellProps {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly contentClassName?: string;
  readonly showBackLink?: boolean;
}

export function DemoPageShell({
  eyebrow,
  title,
  description,
  actions,
  children,
  className = "",
  contentClassName = "max-w-7xl",
  showBackLink = true,
}: DemoPageShellProps) {
  return (
    <div
      className={`min-h-screen bg-[var(--pg-paper)] text-[var(--pg-ink)] ${className}`}
    >
      <div className={`mx-auto px-4 py-8 md:px-6 md:py-10 ${contentClassName}`}>
        <header className="mb-8 flex flex-col gap-4 md:mb-10 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 max-w-3xl">
            {eyebrow ? (
              <p className="mb-2 font-[family-name:var(--font-mono)] text-[10px] tracking-[0.2em] text-[var(--pg-ink-muted)] uppercase">
                {eyebrow}
              </p>
            ) : null}
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-[-0.03em] md:text-4xl">
              {title}
            </h1>
            {description ? (
              <div className="mt-3 text-sm leading-relaxed text-[var(--pg-ink-muted)] md:text-base">
                {description}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
            {showBackLink ? (
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 border border-[var(--pg-line)] bg-[var(--pg-surface)] px-3 py-2 text-xs font-semibold text-[var(--pg-ink-muted)] transition-colors hover:border-[var(--pg-ink)] hover:text-[var(--pg-ink)]"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Playground
              </Link>
            ) : null}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
