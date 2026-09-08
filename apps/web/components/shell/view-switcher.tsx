"use client";

import {
  useCallback,
  useId,
  useRef,
  type FC,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@softmaple/ui/lib/utils";

/**
 * View selection that cannot unmount the view it is switching away from.
 *
 * This is deliberately not a tabs library. Every tabs implementation in common
 * use unmounts inactive panels, which for this product means tearing down the
 * Lexical editor, its collaborative replica and its WebSocket every time
 * somebody glances at the Markdown — losing undo history, selection, and any
 * edit that had not yet been acknowledged. Here, panels are *always* mounted
 * and inactive ones are hidden, so switching views is a visibility change and
 * nothing more.
 *
 * ARIA and keyboard behaviour follow the tabs pattern: arrow keys move between
 * tabs, Home/End jump to the ends, and only the active tab is in the tab order.
 */

export type ViewOption = {
  readonly icon?: ReactNode;
  readonly label: string;
  readonly value: string;
};

export type ViewSwitcherProps = {
  readonly className?: string;
  readonly label: string;
  readonly onValueChange: (value: string) => void;
  readonly options: ReadonlyArray<ViewOption>;
  readonly value: string;
};

/** Shared id derivation so tabs and panels can reference one another. */
export const viewTabId = (base: string, value: string): string =>
  `${base}-tab-${value}`;
export const viewPanelId = (base: string, value: string): string =>
  `${base}-panel-${value}`;

export const useViewSwitcherId = (): string => useId();

export const ViewSwitcher: FC<
  ViewSwitcherProps & { readonly baseId: string }
> = ({ baseId, className, label, onValueChange, options, value }) => {
  const listRef = useRef<HTMLDivElement | null>(null);

  const focusTab = useCallback(
    (index: number) => {
      const option = options[index];
      if (option === undefined) return;
      onValueChange(option.value);
      listRef.current
        ?.querySelector<HTMLButtonElement>(
          `#${CSS.escape(viewTabId(baseId, option.value))}`,
        )
        ?.focus();
    },
    [baseId, onValueChange, options],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const current = options.findIndex((option) => option.value === value);
      if (current === -1) return;
      const last = options.length - 1;
      const next = {
        ArrowRight: current === last ? 0 : current + 1,
        ArrowLeft: current === 0 ? last : current - 1,
        Home: 0,
        End: last,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      focusTab(next);
    },
    [focusTab, options, value],
  );

  return (
    <div
      aria-label={label}
      className={cn("flex items-center gap-1 overflow-x-auto", className)}
      onKeyDown={onKeyDown}
      ref={listRef}
      role="tablist"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            aria-controls={viewPanelId(baseId, option.value)}
            aria-selected={active}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm",
              "text-content-secondary transition-colors hover:text-content",
              active && "bg-quiet font-medium text-content",
            )}
            id={viewTabId(baseId, option.value)}
            key={option.value}
            onClick={() => onValueChange(option.value)}
            role="tab"
            tabIndex={active ? 0 : -1}
            type="button"
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

export type ViewPanelProps = {
  readonly active: boolean;
  readonly baseId: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly value: string;
};

/**
 * One panel. Always rendered; hidden when inactive.
 *
 * `hidden` rather than unmounting is the whole point — but it is also why the
 * panel keeps `tabIndex={-1}` off the DOM when inactive: a hidden panel must
 * not be reachable, and `hidden` already removes it from the accessibility
 * tree and the tab order.
 */
export const ViewPanel: FC<ViewPanelProps> = ({
  active,
  baseId,
  children,
  className,
  value,
}) => (
  <div
    aria-labelledby={viewTabId(baseId, value)}
    className={cn("min-h-0 flex-1", !active && "hidden", className)}
    hidden={!active}
    id={viewPanelId(baseId, value)}
    role="tabpanel"
    tabIndex={active ? 0 : undefined}
  >
    {children}
  </div>
);
