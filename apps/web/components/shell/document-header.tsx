import type { FC, ReactNode } from "react";
import { cn } from "@softmaple/ui/lib/utils";

/**
 * The 56px document header.
 *
 * Its height is fixed so that the editor below it never reflows when the
 * status text changes length, and so a caret near the top of the document does
 * not move when somebody joins.
 */
export type DocumentHeaderProps = {
  /** Identity of the document: title, breadcrumb, rename affordance. */
  readonly children: ReactNode;
  readonly className?: string;
  /** Presence and shared-attention chrome, right-aligned. */
  readonly collaboration?: ReactNode;
  /** Save and connectivity, kept separate from collaboration on purpose. */
  readonly status?: ReactNode;
  /** Sharing, export, overflow. */
  readonly actions?: ReactNode;
};

export const DocumentHeader: FC<DocumentHeaderProps> = ({
  actions,
  children,
  className,
  collaboration,
  status,
}) => (
  <header
    className={cn(
      "document-header flex h-doc-header shrink-0 items-center gap-2 border-b border-divider",
      "bg-document px-3 sm:px-4",
      className,
    )}
  >
    <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    {status !== undefined ? (
      <div className="flex shrink-0 items-center">{status}</div>
    ) : null}
    {collaboration !== undefined ? (
      <div className="flex shrink-0 items-center">{collaboration}</div>
    ) : null}
    {actions !== undefined ? (
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    ) : null}
  </header>
);
