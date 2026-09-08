"use client";

import type { FC } from "react";
import type { PresenceUser } from "@softmaple/awareness";
import type { BlockDocument } from "@softmaple/block-model";
import { useMemo } from "react";
import { useTheme } from "next-themes";
import { cn } from "@softmaple/ui/lib/utils";
import { collaboratorColor } from "@/modules/docs/document-presence-color";
import {
  describeLocation,
  documentSections,
  sectionForBlock,
} from "@/modules/docs/document-sections";

/**
 * Everyone in the document, in a list rather than as overlay decoration.
 *
 * The overlay is bounded to five carets, which is right for the page and wrong
 * as the only answer to "who is here". This view is the complete roster, it is
 * ordinary readable text rather than positioned graphics, and it is where a
 * screen-reader user or anyone in a busy room finds out what is going on.
 */

export const ACTIVITY = {
  Editing: "editing",
  Viewing: "viewing",
  Idle: "idle",
} as const;

export type Activity = (typeof ACTIVITY)[keyof typeof ACTIVITY];

export type PersonActivity = {
  readonly activity: Activity;
  readonly color: string;
  readonly connectionId: string;
  readonly isSelf: boolean;
  readonly location: string;
  readonly name: string;
  readonly userId: string;
};

const ACTIVITY_LABEL: Readonly<Record<Activity, string>> = {
  [ACTIVITY.Editing]: "Editing",
  [ACTIVITY.Viewing]: "Viewing",
  [ACTIVITY.Idle]: "Idle",
};

/**
 * What a person is doing, from their own signals only.
 *
 * A remote edit arriving here says something about its author, never about the
 * reader receiving it — classifying by "the document changed" would mark
 * everyone in the room as editing at once.
 */
export const classifyActivity = (user: PresenceUser): Activity => {
  if (user.meta?.isTyping === true) return ACTIVITY.Editing;
  return user.status === "active" ? ACTIVITY.Viewing : ACTIVITY.Idle;
};

/** The block a person's caret or selection focus is in, if any. */
const focusBlockId = (user: PresenceUser): string | null => {
  const cursor = user.cursor;
  if (cursor !== undefined && "blockId" in cursor) return cursor.blockId;
  const selection = user.selection;
  if (selection === undefined) return null;
  return "blockId" in selection ? selection.blockId : selection.focus.blockId;
};

export const describePeople = ({
  document,
  people,
  selfConnectionId,
  theme,
}: {
  readonly document: BlockDocument | null;
  readonly people: ReadonlyArray<PresenceUser>;
  readonly selfConnectionId: string | null;
  readonly theme: "light" | "dark";
}): ReadonlyArray<PersonActivity> => {
  const sections = document === null ? [] : documentSections(document);
  return people.map((user) => {
    const blockId = focusBlockId(user);
    return {
      activity: classifyActivity(user),
      color: collaboratorColor(user.userId, theme).color,
      connectionId: user.connectionId,
      isSelf: user.connectionId === selfConnectionId,
      location:
        blockId === null
          ? "in this document"
          : describeLocation(sectionForBlock(sections, blockId)),
      name: user.name,
      userId: user.userId,
    };
  });
};

export type PeopleAndActivityProps = {
  readonly document: BlockDocument | null;
  readonly people: ReadonlyArray<PresenceUser>;
  readonly selfConnectionId: string | null;
};

export const PeopleAndActivity: FC<PeopleAndActivityProps> = ({
  document,
  people,
  selfConnectionId,
}) => {
  const { resolvedTheme } = useTheme();
  const described = useMemo(
    () =>
      describePeople({
        document,
        people,
        selfConnectionId,
        theme: resolvedTheme === "dark" ? "dark" : "light",
      }),
    [document, people, resolvedTheme, selfConnectionId],
  );

  if (described.length === 0) {
    return (
      <p className="px-1 py-2 text-sm text-content-secondary">
        Nobody else is in this document right now.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1" aria-label="People and activity">
      {described.map((person) => (
        <li
          className="flex items-center gap-2 rounded-lg px-1 py-1.5"
          key={person.connectionId}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              "forced-colors:border forced-colors:border-[CanvasText]",
            )}
            style={{ background: person.color }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">
              {person.name}
              {person.isSelf ? (
                <span className="text-content-secondary"> (you)</span>
              ) : null}
            </span>
            <span className="block truncate text-xs text-content-secondary">
              {`${ACTIVITY_LABEL[person.activity]} ${person.location}`}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
};
