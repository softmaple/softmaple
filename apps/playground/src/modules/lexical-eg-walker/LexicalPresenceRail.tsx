import type { PresenceUser } from "@softmaple/awareness";
import { MousePointer2, Users } from "lucide-react";

interface LexicalPresenceRailProps {
  readonly selfId: string;
  readonly users: ReadonlyArray<PresenceUser>;
}

const initials = (name: string): string => name.slice(0, 2).toUpperCase();

export function LexicalPresenceRail({
  selfId,
  users,
}: LexicalPresenceRailProps) {
  return (
    <aside
      className="hidden w-52 shrink-0 flex-col border-r border-[var(--pg-line)] bg-[var(--pg-surface)]/35 px-4 py-5 lg:flex"
      aria-label="Room presence"
    >
      <p className="font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.2em] text-[var(--pg-ink-muted)] uppercase">
        Presence
      </p>

      {users.length === 0 ? (
        <p className="mt-5 text-xs leading-relaxed text-[var(--pg-ink-muted)]">
          Waiting for room presence…
        </p>
      ) : (
        <ul className="mt-4 space-y-1.5">
          {users.map((user) => {
            const hasSelection =
              user.cursor !== undefined || user.selection !== undefined;
            const isSelf = user.userId === selfId;

            return (
              <li
                key={user.connectionId}
                className="flex min-w-0 items-center gap-2.5 border border-transparent px-2 py-2 text-xs hover:border-[var(--pg-line)] hover:bg-[var(--pg-elevated)]/55"
              >
                <span
                  className="grid size-7 shrink-0 place-items-center text-[9px] font-bold text-white"
                  style={{ backgroundColor: user.color }}
                  aria-hidden
                >
                  {hasSelection ? (
                    <MousePointer2 className="size-3.5" />
                  ) : (
                    initials(user.name)
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[var(--pg-ink)]">
                    {user.name}
                  </span>
                  <span className="block truncate font-[family-name:var(--font-mono)] text-[9px] tracking-wide text-[var(--pg-ink-muted)] uppercase">
                    {isSelf ? "You" : user.status}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-auto flex items-center gap-2 border-t border-[var(--pg-line)] pt-4 font-[family-name:var(--font-mono)] text-[10px] text-[var(--pg-ink-muted)]">
        <Users className="size-3.5 text-[var(--pg-accent)]" aria-hidden />
        {users.length} online
      </div>
    </aside>
  );
}
