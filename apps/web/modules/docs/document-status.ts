import {
  STATUS_LEVEL,
  type StatusLevel,
} from "@/components/shell/status-indicator";
import type {
  CollaborationStatus,
  SaveStatus,
} from "@/modules/docs/document-save-coordinator";

/**
 * Two independent readings of one document.
 *
 * `deriveDocumentUiStatus` collapses save and collaboration into a single
 * label, which loses the one thing a writer actually needs during a network
 * problem: whether their work is safe. These descriptors keep the two facts
 * apart so the header can show both, and so neither can mask the other.
 *
 * The collapsed status is still produced for callers that genuinely want one
 * word (a screen-reader summary, the public read-only view); it is no longer
 * the only thing available.
 */

export type StatusDescriptor = {
  /** Whether the person can do something about it right now. */
  readonly actionable: boolean;
  /** Full sentence, for tooltips and assistive technology. */
  readonly detail: string;
  /** Two or three words, for the header. */
  readonly label: string;
  readonly level: StatusLevel;
  readonly name: string;
};

const SAVE_DESCRIPTORS: Readonly<Record<SaveStatus, StatusDescriptor>> = {
  idle: {
    actionable: false,
    detail: "No unsaved changes.",
    label: "Saved",
    level: STATUS_LEVEL.Settled,
    name: "Save state",
  },
  saving: {
    actionable: false,
    detail: "Saving your changes.",
    label: "Saving…",
    level: STATUS_LEVEL.Working,
    name: "Save state",
  },
  saved: {
    actionable: false,
    detail: "All changes are saved.",
    label: "Saved",
    level: STATUS_LEVEL.Settled,
    name: "Save state",
  },
  error: {
    actionable: true,
    detail:
      "Your recent changes could not be saved. They are kept in this tab — " +
      "retry, and keep the tab open until it succeeds.",
    label: "Not saved",
    level: STATUS_LEVEL.Critical,
    name: "Save state",
  },
};

const COLLABORATION_DESCRIPTORS: Readonly<
  Record<CollaborationStatus, StatusDescriptor>
> = {
  disabled: {
    actionable: false,
    detail:
      "This document is private, so live collaboration is off. Changes save " +
      "normally.",
    label: "Private",
    level: STATUS_LEVEL.Settled,
    name: "Live collaboration",
  },
  connecting: {
    actionable: false,
    detail: "Connecting to the other people in this document.",
    label: "Connecting…",
    level: STATUS_LEVEL.Working,
    name: "Live collaboration",
  },
  connected: {
    actionable: false,
    detail: "Live. You can see other people, and they can see you.",
    label: "Live",
    level: STATUS_LEVEL.Settled,
    name: "Live collaboration",
  },
  reconnecting: {
    actionable: false,
    detail:
      "Reconnecting. You can keep writing; your changes are kept and sent " +
      "when the connection returns.",
    label: "Reconnecting…",
    level: STATUS_LEVEL.Caution,
    name: "Live collaboration",
  },
  offline: {
    actionable: true,
    detail:
      "Offline. You can keep writing; your changes are kept and sent when the " +
      "connection returns.",
    label: "Offline",
    level: STATUS_LEVEL.Caution,
    name: "Live collaboration",
  },
  error: {
    actionable: true,
    detail:
      "Live collaboration stopped. Reconnect to see other people again; your " +
      "own changes still save.",
    label: "Not live",
    level: STATUS_LEVEL.Critical,
    name: "Live collaboration",
  },
};

/** How durable the work is. Never affected by the presence transport. */
export const describeSaveStatus = (status: SaveStatus): StatusDescriptor =>
  SAVE_DESCRIPTORS[status];

/** Whether other people are reachable. Never claims anything about saving. */
export const describeCollaborationStatus = (
  status: CollaborationStatus,
): StatusDescriptor => COLLABORATION_DESCRIPTORS[status];

/**
 * A single spoken sentence for assistive technology, naming both facts in the
 * order that matters: durability first, company second.
 */
export const summariseDocumentStatus = ({
  collaborationStatus,
  saveStatus,
}: {
  readonly collaborationStatus: CollaborationStatus;
  readonly saveStatus: SaveStatus;
}): string =>
  `${describeSaveStatus(saveStatus).detail} ${
    describeCollaborationStatus(collaborationStatus).detail
  }`;
