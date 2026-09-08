import { type ReactNode, useContext, useId, useRef, useState } from "react";
import type { AdapterConnectionState } from "../adapters/types";
import { PresenceContext } from "../providers/presence-context";
import type { PresenceUser } from "../types/presence";
import { ConnectionIndicator } from "./connection-indicator";
import { cx, sortPresenceUsers } from "./internal-utils";
import { PresenceAvatar } from "./presence-avatar";

export interface CollaborationBarProps {
  /** All sessions, including self. Defaults to the presence provider. */
  readonly users?: ReadonlyArray<PresenceUser>;
  readonly state?: AdapterConnectionState;
  /** Account ID used for the “You” label and stable first position. */
  readonly selfUserId?: string;
  /** Controlled cursor visibility. The control appears when a callback is supplied. */
  readonly cursorsVisible?: boolean;
  readonly onCursorsVisibleChange?: (visible: boolean) => void;
  readonly className?: string;
}

/** One person per row; keep the most active session as their representative. */
export const groupCollaborators = (
  users: ReadonlyArray<PresenceUser>,
  selfUserId?: string,
): ReadonlyArray<{
  readonly user: PresenceUser;
  readonly sessions: number;
}> => {
  const groups = new Map<string, { user: PresenceUser; sessions: number }>();
  for (const user of sortPresenceUsers(users)) {
    if (user.status === "offline") continue;
    const previous = groups.get(user.userId);
    groups.set(user.userId, {
      user: previous?.user ?? user,
      sessions: (previous?.sessions ?? 0) + 1,
    });
  }
  return [...groups.values()].sort((a, b) => {
    if (a.user.userId === selfUserId) return -1;
    if (b.user.userId === selfUserId) return 1;
    return (
      a.user.name.localeCompare(b.user.name) ||
      a.user.userId.localeCompare(b.user.userId)
    );
  });
};

const CONNECTION_LABELS = {
  connected: "Connected",
  connecting: "Connecting…",
  authenticating: "Connecting…",
  syncing: "Finding collaborators…",
  reconnecting: "Reconnecting…",
  disconnected: "Presence offline",
  error: "Presence unavailable",
};

/** A compact document roster with an inline, keyboard-accessible disclosure. */
export const CollaborationBar = ({
  users,
  state,
  selfUserId,
  cursorsVisible = true,
  onCursorsVisibleChange,
  className,
}: CollaborationBarProps): ReactNode => {
  const context = useContext(PresenceContext);
  const resolvedState = state ?? context?.connectionState ?? "disconnected";
  const resolvedSelf = selfUserId ?? context?.self?.userId;
  const people = groupCollaborators(
    users ?? [...(context?.presence.values() ?? [])],
    resolvedSelf,
  );
  const connected = resolvedState === "connected";
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const countLabel =
    people.length === 1 && people[0]?.user.userId === resolvedSelf
      ? "Just you here"
      : `${people.length} ${people.length === 1 ? "person" : "people"} here`;

  return (
    <div className={cx("awareness-collaboration", className)}>
      <div className="awareness-collaboration__bar">
        <span className="awareness-collaboration__heading">
          In this document
        </span>
        <ConnectionIndicator
          state={resolvedState}
          labels={CONNECTION_LABELS}
          hideWhenConnected={false}
        />
        <button
          ref={trigger}
          type="button"
          className="awareness-collaboration__trigger"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={
            connected
              ? `${countLabel}. ${expanded ? "Hide" : "Show"} collaborators`
              : "Collaboration details"
          }
          onClick={() => setExpanded((value) => !value)}
        >
          {connected ? (
            <span
              aria-hidden="true"
              className="awareness-collaboration__avatars"
            >
              {people.slice(0, 3).map(({ user }) => (
                <PresenceAvatar
                  key={user.userId}
                  user={user}
                  size="sm"
                  showStatus={false}
                />
              ))}
              {people.length > 3 ? (
                <span className="awareness-collaboration__overflow">
                  +{people.length - 3}
                </span>
              ) : null}
            </span>
          ) : null}
          <span>{connected ? countLabel : "Details"}</span>
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            className="awareness-collaboration__chevron"
          >
            <path
              d="m3 4.5 3 3 3-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
      </div>
      <section
        id={panelId}
        aria-label="Collaborators in this document"
        className="awareness-collaboration__panel"
        hidden={!expanded}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          setExpanded(false);
          trigger.current?.focus();
        }}
      >
        {connected && people.length > 0 ? (
          <ul
            className="awareness-collaboration__roster"
            aria-label="People in this document"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the bounded roster needs a tab stop for keyboard scrolling.
            tabIndex={0}
          >
            {people.map(({ user, sessions }) => (
              <li key={user.userId} className="awareness-collaboration__person">
                <PresenceAvatar user={user} />
                <span className="awareness-collaboration__identity">
                  <span className="awareness-collaboration__name">
                    {user.name}
                    {user.userId === resolvedSelf ? (
                      <span className="awareness-collaboration__you">You</span>
                    ) : null}
                  </span>
                  <span className="awareness-collaboration__activity">
                    {user.status === "idle"
                      ? "Away"
                      : user.meta?.isTyping === true
                        ? "Typing"
                        : "Here now"}
                    {sessions > 1 ? ` · ${sessions} sessions` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="awareness-collaboration__notice">
            {connected
              ? "No collaborators are here yet."
              : "Collaborators will appear when presence reconnects. Document saving is shown separately."}
          </p>
        )}
        <div className="awareness-collaboration__footer">
          <p>Colors match each person’s cursor and selection.</p>
          {onCursorsVisibleChange ? (
            <label className="awareness-collaboration__preference">
              <input
                type="checkbox"
                checked={cursorsVisible}
                onChange={(event) =>
                  onCursorsVisibleChange(event.target.checked)
                }
              />
              Show collaborator cursors
            </label>
          ) : null}
        </div>
      </section>
    </div>
  );
};
