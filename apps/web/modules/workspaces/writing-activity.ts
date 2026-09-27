import { z } from "zod";

/**
 * "Happening now" reads durable writing activity: who changed which document
 * recently, from the event history every collaboration runtime appends to.
 * Live presence stays inside the editor; this is the workspace-wide view.
 */

/** How far back a change still counts as writing that is happening now. */
export const WRITING_ACTIVITY_WINDOW_SECONDS = 300;

/** How often a visible workspace home asks for fresh writing activity. */
export const WRITING_ACTIVITY_REFRESH_MS = 30_000;

export type WritingActivityRow = {
  readonly avatarSrc: string | null;
  readonly documentId: string;
  readonly documentSlug: string;
  readonly documentTitle: string;
  readonly fullName: string;
  readonly lastWrittenAt: string;
  readonly userId: string;
};

export type ActiveWriter = {
  readonly avatarSrc: string | null;
  readonly fullName: string;
  readonly isViewer: boolean;
  readonly lastWrittenAt: string;
  readonly userId: string;
};

export type ActiveDocument = {
  readonly id: string;
  readonly lastWrittenAt: string;
  readonly slug: string;
  readonly title: string;
  /** Most recent writer first. */
  readonly writers: ReadonlyArray<ActiveWriter>;
};

export type WritingActivitySnapshot = {
  /** Most relevant first; see `groupWritingActivity`. */
  readonly documents: ReadonlyArray<ActiveDocument>;
  /** Server clock at read time, so relative times never use a client clock. */
  readonly observedAt: string;
};

const timestamp = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid timestamp");

const activeWriterSchema = z.object({
  avatarSrc: z.string().nullable(),
  fullName: z.string(),
  isViewer: z.boolean(),
  lastWrittenAt: timestamp,
  userId: z.string().min(1),
});

/** Validates a snapshot received over the network before it is rendered. */
export const writingActivitySnapshotSchema = z.object({
  documents: z.array(
    z.object({
      id: z.string().min(1),
      lastWrittenAt: timestamp,
      slug: z.string().min(1),
      title: z.string(),
      writers: z.array(activeWriterSchema).min(1),
    }),
  ),
  observedAt: timestamp,
});

const timeOf = (value: string): number => Date.parse(value);

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareWriters = (left: ActiveWriter, right: ActiveWriter): number =>
  timeOf(right.lastWrittenAt) - timeOf(left.lastWrittenAt) ||
  left.fullName.localeCompare(right.fullName) ||
  compareText(left.userId, right.userId);

/** Whether anyone besides the viewer is writing in the document. */
export const hasOtherWriters = (document: ActiveDocument): boolean =>
  document.writers.some((writer) => !writer.isViewer);

/**
 * Ranks where collaboration is happening: documents other members are writing
 * in come first, then more writers, then the most recent change. Writer count
 * outranks recency so the featured document does not flip between polls
 * whenever someone elsewhere types a moment later.
 */
const compareDocuments = (left: ActiveDocument, right: ActiveDocument) =>
  Number(hasOtherWriters(right)) - Number(hasOtherWriters(left)) ||
  right.writers.length - left.writers.length ||
  timeOf(right.lastWrittenAt) - timeOf(left.lastWrittenAt) ||
  compareText(left.id, right.id);

/** Keeps each member's newest row, whatever order rows arrive in. */
const latestPerWriter = (
  rows: ReadonlyArray<WritingActivityRow>,
): ReadonlyArray<WritingActivityRow> => [
  ...rows
    .reduce((latest, row) => {
      const known = latest.get(row.userId);
      return known !== undefined &&
        timeOf(known.lastWrittenAt) >= timeOf(row.lastWrittenAt)
        ? latest
        : new Map(latest).set(row.userId, row);
    }, new Map<string, WritingActivityRow>())
    .values(),
];

const toActiveDocument = (
  rows: ReadonlyArray<WritingActivityRow>,
  viewerId: string,
): ActiveDocument | null => {
  const writers = latestPerWriter(rows)
    .map(
      (row): ActiveWriter => ({
        avatarSrc: row.avatarSrc,
        fullName: row.fullName,
        isViewer: row.userId === viewerId,
        lastWrittenAt: row.lastWrittenAt,
        userId: row.userId,
      }),
    )
    .sort(compareWriters);
  const [document] = rows;
  const [latest] = writers;
  if (document === undefined || latest === undefined) return null;
  return {
    id: document.documentId,
    lastWrittenAt: latest.lastWrittenAt,
    slug: document.documentSlug,
    title: document.documentTitle,
    writers,
  };
};

/** Groups per-writer activity rows into ranked documents for one viewer. */
export const groupWritingActivity = (
  rows: ReadonlyArray<WritingActivityRow>,
  viewerId: string,
): ReadonlyArray<ActiveDocument> =>
  [...new Set(rows.map((row) => row.documentId))]
    .flatMap((documentId) => {
      const document = toActiveDocument(
        rows.filter((row) => row.documentId === documentId),
        viewerId,
      );
      return document === null ? [] : [document];
    })
    .sort(compareDocuments);

/** "Mia", "You and Mia", "Mia, Leo and Sarah", "Mia, Leo and 2 others". */
export const describeWriters = (
  writers: ReadonlyArray<ActiveWriter>,
): string => {
  const names = [
    ...writers.filter((writer) => writer.isViewer).map(() => "You"),
    ...writers
      .filter((writer) => !writer.isViewer)
      .map((writer) => writer.fullName),
  ];
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) {
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
};

/** The sentence beside a featured document, written for the viewer. */
export const describeHappeningNow = (document: ActiveDocument): string => {
  if (!hasOtherWriters(document)) return "You were just writing here.";
  const verb = document.writers.length === 1 ? "is" : "are";
  return `${describeWriters(document.writers)} ${verb} shaping this document.`;
};

/** "1 person" or "3 people", for "… writing". */
export const describeWriterCount = (count: number): string =>
  `${count} ${count === 1 ? "person" : "people"}`;

/** Age of the latest change, measured on the server clock. */
export const describeLastChange = (
  lastWrittenAt: string,
  observedAt: string,
): string => {
  const seconds = Math.max(
    0,
    Math.floor((timeOf(observedAt) - timeOf(lastWrittenAt)) / 1000),
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
};

/** "The latest words landed 2 minutes ago." — "Your …" when only the viewer wrote. */
export const describeLatestWords = (
  document: ActiveDocument,
  observedAt: string,
): string =>
  `${hasOtherWriters(document) ? "The" : "Your"} latest words landed ${describeLastChange(document.lastWrittenAt, observedAt)}.`;
