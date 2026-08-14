import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { RoomIdentity } from "./presence";
import { StatusRail, type StatusRailProps } from "./StatusRail";

interface LexicalWorkspaceChromeProps extends StatusRailProps {
  readonly identity: RoomIdentity;
}

export function LexicalWorkspaceChrome({
  identity,
  users,
  ...statusProps
}: LexicalWorkspaceChromeProps) {
  return (
    <div className="relative z-30 border-b border-[var(--pg-line)] bg-[var(--pg-surface)]/95 backdrop-blur-xl">
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 md:hidden">
        <Link
          to="/"
          className="pg-focus-ring inline-flex min-h-11 min-w-0 items-center gap-2 text-[var(--pg-ink)] active:translate-y-px"
          aria-label="Back to Playground"
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden />
          <span className="truncate font-[family-name:var(--font-display)] text-sm font-bold tracking-[-0.02em]">
            SoftMaple
            <span className="ml-1.5 font-normal text-[var(--pg-ink-muted)]">
              Playground
            </span>
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] text-[var(--pg-ink-muted)]">
          <span
            className="grid size-7 place-items-center text-[9px] font-bold text-white"
            style={{ backgroundColor: identity.color }}
            title={identity.name}
          >
            {identity.name.slice(0, 2).toUpperCase()}
          </span>
          {users.length} online
        </div>
      </div>

      <div className="flex min-w-0">
        <Link
          to="/"
          className="pg-focus-ring hidden w-52 shrink-0 items-center border-r border-[var(--pg-line)] px-5 font-[family-name:var(--font-display)] text-sm font-bold tracking-[-0.03em] text-[var(--pg-ink)] hover:bg-[var(--pg-elevated)]/45 active:translate-y-px md:flex"
        >
          SoftMaple
          <span className="ml-1.5 font-normal text-[var(--pg-ink-muted)]">
            Playground
          </span>
        </Link>
        <StatusRail users={users} {...statusProps} />
      </div>
    </div>
  );
}
