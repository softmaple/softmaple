import type { FC } from "react";

/** A quiet, non-interactive brand pause for the workspace rail. */
export const WorkspaceBrandPanel: FC = () => (
  <section
    aria-label="Softmaple motto"
    className="relative isolate flex min-h-0 flex-1 items-end overflow-hidden px-7 pb-12 pt-16"
  >
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -right-24 top-4 -z-10 size-72 bg-[url('/landing/veined-maple.webp')] bg-contain bg-center bg-no-repeat opacity-[0.11] dark:bg-[url('/auth/veined-maple-dark.webp')] dark:opacity-[0.07]"
    />
    <p className="workspace-motto relative ml-auto max-w-48 rotate-[-3deg] text-right text-[2.05rem] leading-[0.98] text-foreground/78">
      <span className="block">Same thoughts</span>
      <span className="relative mt-2 inline-block text-foreground">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-3 -inset-y-1 -z-10 -rotate-2 bg-[url('/landing/together-brush.svg')] bg-[length:100%_100%] bg-center bg-no-repeat opacity-35 dark:opacity-15"
        />
        brighter tomorrow
      </span>
    </p>
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-8 right-7 h-px w-14 rotate-[-18deg] bg-[var(--workspace-gold)] opacity-60"
    />
  </section>
);
