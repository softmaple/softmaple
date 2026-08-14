import { Skeleton } from "@softmaple/ui/components/skeleton";
import { cn } from "@softmaple/ui/lib/utils";
import { RaspberryRecordMark } from "@/components/BrandMark";

const PLACEHOLDER_CARDS = ["document", "workspace", "activity"] as const;

export type RouteLoadingProps = {
  readonly className?: string;
  readonly label?: string;
};

export function RouteLoading({
  className,
  label = "Loading Softmaple",
}: RouteLoadingProps) {
  return (
    <main
      aria-busy="true"
      aria-label={label}
      className={cn(
        "min-h-[calc(100dvh-3.5rem)] bg-background px-4 py-10 sm:px-6 sm:py-14",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex items-center gap-3 border-b pb-5">
          <RaspberryRecordMark />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
              Retrieving record
            </p>
            <Skeleton className="mt-2 h-5 w-44 max-w-full rounded-sm" />
          </div>
        </div>

        <div className="mt-8 space-y-3">
          <Skeleton className="h-9 w-80 max-w-[82%] rounded-sm" />
          <Skeleton className="h-4 w-[32rem] max-w-full rounded-sm" />
        </div>

        <div className="mt-9 grid gap-px overflow-hidden border bg-border sm:grid-cols-3">
          {PLACEHOLDER_CARDS.map((card) => (
            <section className="bg-card p-5 sm:min-h-48" key={card}>
              <Skeleton className="size-9 rounded-sm" />
              <Skeleton className="mt-10 h-5 w-2/3 rounded-sm" />
              <Skeleton className="mt-3 h-3 w-full rounded-sm" />
              <Skeleton className="mt-2 h-3 w-4/5 rounded-sm" />
            </section>
          ))}
        </div>
      </div>
      <span className="sr-only" role="status">
        {label}
      </span>
    </main>
  );
}
