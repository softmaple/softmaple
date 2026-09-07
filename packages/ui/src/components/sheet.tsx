"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

import { cn } from "@softmaple/ui/lib/utils";

const SheetSide = {
  Top: "top",
  Right: "right",
  Bottom: "bottom",
  Left: "left",
} as const;

type SheetSide = (typeof SheetSide)[keyof typeof SheetSide];

/**
 * Edge-specific geometry and motion. Bottom and top sheets are capped and
 * scrollable so long content never runs past the viewport, and both round the
 * corners that face into the page.
 */
const sheetSideStyles: Readonly<Record<SheetSide, string>> = {
  top: "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 max-h-[85dvh] overflow-y-auto rounded-b-2xl border-b pt-[env(safe-area-inset-top)]",
  right:
    "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
  bottom:
    "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)]",
  left: "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
};

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A tap target that sits where a thumb already is. It reads as the drag
 * affordance people expect on a bottom sheet and closes on activation, so the
 * grabber is a real control rather than decoration.
 */
function SheetHandle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return (
    <SheetPrimitive.Close
      data-slot="sheet-handle"
      className={cn(
        "group bg-background focus-visible:ring-ring sticky top-0 z-10 -mb-2 flex shrink-0 items-center justify-center pt-3 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-inset",
        className,
      )}
      {...props}
    >
      <span className="bg-muted-foreground/35 group-hover:bg-muted-foreground/60 h-1.5 w-10 rounded-full transition-colors" />
      <span className="sr-only">Close</span>
    </SheetPrimitive.Close>
  );
}

type SheetContentProps = React.ComponentProps<typeof SheetPrimitive.Content> & {
  /** Edge the sheet is anchored to. Defaults to `right`. */
  readonly side?: SheetSide;
  /** Grabber affordance. Defaults to on for bottom sheets, off elsewhere. */
  readonly showHandle?: boolean;
  /** Corner dismiss button. Defaults to on wherever the grabber is not shown. */
  readonly showCloseButton?: boolean;
};

function SheetContent({
  className,
  children,
  side = SheetSide.Right,
  showHandle,
  showCloseButton,
  ...props
}: SheetContentProps) {
  const hasHandle = showHandle ?? side === SheetSide.Bottom;
  const hasCloseButton = showCloseButton ?? !hasHandle;

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-200 data-[state=open]:duration-300",
          sheetSideStyles[side],
          className,
        )}
        {...props}
      >
        {hasHandle ? <SheetHandle /> : null}
        {children}
        {hasCloseButton ? (
          <SheetPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHandle,
  SheetHeader,
  SheetFooter,
  SheetSide,
  SheetTitle,
  SheetDescription,
};
export type { SheetContentProps };
