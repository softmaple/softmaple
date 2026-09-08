import type { ComponentProps, FC } from "react";
import { cn } from "@softmaple/ui/lib/utils";

/**
 * The three grounds the product is built from.
 *
 * `workspace` is what you move around in, `document` is what you write on, and
 * `raised` sits above either one (menus, sheets, the shared-context panel).
 * Naming them here is what stops a component from inventing a fourth.
 */
export const SURFACE = {
  Workspace: "workspace",
  Document: "document",
  Raised: "raised",
  Quiet: "quiet",
} as const;

export type SurfaceTone = (typeof SURFACE)[keyof typeof SURFACE];

const TONE_CLASS: Readonly<Record<SurfaceTone, string>> = {
  [SURFACE.Workspace]: "bg-workspace text-content",
  [SURFACE.Document]: "bg-document text-content",
  [SURFACE.Raised]: "bg-raised text-content shadow-sm",
  [SURFACE.Quiet]: "bg-quiet text-content",
};

export type SurfaceProps = ComponentProps<"div"> & {
  readonly tone?: SurfaceTone;
  /** Draw the divider-coloured hairline that separates surfaces. */
  readonly bordered?: boolean;
};

export const Surface: FC<SurfaceProps> = ({
  bordered = false,
  className,
  tone = SURFACE.Workspace,
  ...props
}) => (
  <div
    className={cn(
      TONE_CLASS[tone],
      bordered && "border border-divider",
      tone === SURFACE.Raised && "surface-raised",
      className,
    )}
    {...props}
  />
);
