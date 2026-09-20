import { cn } from "@softmaple/ui/lib/utils";

/** Shared static paper artwork: the texture and grazing edge light are baked in. */
export function PaperRibbon({ className }: { readonly className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0",
        "bg-[url('/auth/paper-login-cutout.webp')] bg-cover bg-position-[center_43%] bg-no-repeat dark:bg-[url('/auth/paper-login-dark.webp')]",
        "sm:bg-size-[100%_180%] sm:bg-position-[center_40%] [mask-image:linear-gradient(to_bottom,transparent,#000_18%)]",
        className,
      )}
    />
  );
}
