"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@softmaple/ui/lib/utils";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

const subscribe = () => () => {};

/** The stored theme is only known in the browser; render no choice until then. */
const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

/** Segmented Light / Dark / System control that shows the current choice. */
export function ThemeChoice({ labelledBy }: { readonly labelledBy: string }) {
  const { theme, setTheme } = useTheme();
  const current = useHydrated() ? (theme ?? "system") : undefined;
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="inline-flex w-fit max-w-full self-start rounded-md border border-input p-0.5 shadow-xs dark:bg-input/30"
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <label
          key={value}
          className={cn(
            "flex min-h-10 cursor-pointer items-center gap-2 rounded-[calc(var(--radius)-3px)] px-3 text-sm text-muted-foreground transition-colors hover:text-foreground md:min-h-8",
            "has-[:checked]:bg-secondary has-[:checked]:text-secondary-foreground",
            "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-ring",
          )}
        >
          <input
            type="radio"
            name="theme"
            value={value}
            className="sr-only"
            checked={current === value}
            onChange={() => setTheme(value)}
          />
          <Icon aria-hidden="true" className="size-4" />
          {label}
        </label>
      ))}
    </div>
  );
}
