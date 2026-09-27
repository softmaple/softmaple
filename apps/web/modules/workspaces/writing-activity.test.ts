import { describe, expect, it } from "vitest";
import {
  describeHappeningNow,
  describeLastChange,
  describeLatestWords,
  describeWriterCount,
  describeWriters,
  groupWritingActivity,
  writingActivitySnapshotSchema,
  type ActiveWriter,
  type WritingActivityRow,
} from "./writing-activity";

const VIEWER = "viewer";

const row = (
  documentId: string,
  userId: string,
  lastWrittenAt: string,
): WritingActivityRow => ({
  avatarSrc: null,
  documentId,
  documentSlug: `${documentId}-slug`,
  documentTitle: `${documentId} title`,
  fullName: userId === VIEWER ? "Adam" : userId,
  lastWrittenAt,
  userId,
});

const writer = (fullName: string, isViewer = false): ActiveWriter => ({
  avatarSrc: null,
  fullName,
  isViewer,
  lastWrittenAt: "2026-09-27T10:00:00.000Z",
  userId: fullName.toLowerCase(),
});

describe("groupWritingActivity", () => {
  it("groups writers per document, newest writer first", () => {
    const [document] = groupWritingActivity(
      [
        row("draft", "Leo", "2026-09-27T10:01:00.000Z"),
        row("draft", VIEWER, "2026-09-27T10:02:00.000Z"),
        row("draft", "Mia", "2026-09-27T10:03:00+00:00"),
      ],
      VIEWER,
    );
    expect(document).toEqual({
      id: "draft",
      lastWrittenAt: "2026-09-27T10:03:00+00:00",
      slug: "draft-slug",
      title: "draft title",
      writers: [
        expect.objectContaining({ fullName: "Mia", isViewer: false }),
        expect.objectContaining({ fullName: "Adam", isViewer: true }),
        expect.objectContaining({ fullName: "Leo", isViewer: false }),
      ],
    });
  });

  it("features documents where others write before the viewer's own", () => {
    const documents = groupWritingActivity(
      [
        row("mine", VIEWER, "2026-09-27T10:05:00.000Z"),
        row("shared", "Mia", "2026-09-27T10:01:00.000Z"),
      ],
      VIEWER,
    );
    expect(documents.map((document) => document.id)).toEqual([
      "shared",
      "mine",
    ]);
  });

  it("ranks by writer count, then recency, then id", () => {
    const documents = groupWritingActivity(
      [
        row("recent-solo", "Mia", "2026-09-27T10:09:00.000Z"),
        row("pair", "Mia", "2026-09-27T10:01:00.000Z"),
        row("pair", "Leo", "2026-09-27T10:02:00.000Z"),
        row("b-tie", "Sarah", "2026-09-27T10:04:00.000Z"),
        row("a-tie", "Sarah", "2026-09-27T10:04:00.000Z"),
      ],
      VIEWER,
    );
    expect(documents.map((document) => document.id)).toEqual([
      "pair",
      "recent-solo",
      "a-tie",
      "b-tie",
    ]);
  });

  it("keeps only the newest row when a writer repeats", () => {
    const [document] = groupWritingActivity(
      [
        row("draft", "Mia", "2026-09-27T10:04:00.000Z"),
        row("draft", "Mia", "2026-09-27T10:01:00.000Z"),
      ],
      VIEWER,
    );
    expect(document?.writers).toHaveLength(1);
    expect(document?.lastWrittenAt).toBe("2026-09-27T10:04:00.000Z");
  });

  it("returns no documents for no activity and leaves input untouched", () => {
    const rows = Object.freeze([
      row("draft", "Leo", "2026-09-27T10:01:00.000Z"),
      row("draft", "Mia", "2026-09-27T10:02:00.000Z"),
    ]);
    groupWritingActivity(rows, VIEWER);
    expect(rows.map((item) => item.userId)).toEqual(["Leo", "Mia"]);
    expect(groupWritingActivity([], VIEWER)).toEqual([]);
  });
});

describe("activity copy", () => {
  it.each([
    [[writer("Mia")], "Mia"],
    [[writer("Mia"), writer("Leo")], "Mia and Leo"],
    [[writer("Mia"), writer("Leo"), writer("Sarah")], "Mia, Leo and Sarah"],
    [
      [writer("Mia"), writer("Leo"), writer("Sarah"), writer("Ines")],
      "Mia, Leo and 2 others",
    ],
    [[writer("Mia"), writer("Adam", true)], "You and Mia"],
  ])("names writers %#", (writers, expected) => {
    expect(describeWriters(writers)).toBe(expected);
  });

  it("describes the featured document from the viewer's side", () => {
    const document = {
      id: "draft",
      lastWrittenAt: "2026-09-27T10:00:00.000Z",
      slug: "draft",
      title: "Draft",
    };
    expect(
      describeHappeningNow({ ...document, writers: [writer("Adam", true)] }),
    ).toBe("You were just writing here.");
    expect(
      describeHappeningNow({ ...document, writers: [writer("Mia")] }),
    ).toBe("Mia is shaping this document.");
    expect(
      describeHappeningNow({
        ...document,
        writers: [writer("Mia"), writer("Adam", true)],
      }),
    ).toBe("You and Mia are shaping this document.");
  });

  it("dates the latest words for whoever wrote them", () => {
    const document = {
      id: "draft",
      lastWrittenAt: "2026-09-27T09:58:00.000Z",
      slug: "draft",
      title: "Draft",
    };
    const observedAt = "2026-09-27T10:00:00.000Z";
    expect(
      describeLatestWords(
        { ...document, writers: [writer("Mia"), writer("Adam", true)] },
        observedAt,
      ),
    ).toBe("The latest words landed 2 minutes ago.");
    expect(
      describeLatestWords(
        { ...document, writers: [writer("Adam", true)] },
        observedAt,
      ),
    ).toBe("Your latest words landed 2 minutes ago.");
  });

  it("counts people", () => {
    expect(describeWriterCount(1)).toBe("1 person");
    expect(describeWriterCount(3)).toBe("3 people");
  });

  it.each([
    ["2026-09-27T10:00:00.000Z", "just now"],
    ["2026-09-27T09:59:01.000Z", "just now"],
    ["2026-09-27T09:59:00.000Z", "1 minute ago"],
    ["2026-09-27T09:57:30.000Z", "2 minutes ago"],
    ["2026-09-27T09:00:00.000Z", "1 hour ago"],
    // Database and web clocks can disagree slightly; never say "in the future".
    ["2026-09-27T10:00:05.000Z", "just now"],
  ])("ages a change written at %s", (lastWrittenAt, expected) => {
    expect(describeLastChange(lastWrittenAt, "2026-09-27T10:00:00.000Z")).toBe(
      expected,
    );
  });
});

describe("writingActivitySnapshotSchema", () => {
  const snapshot = {
    documents: [
      {
        id: "draft",
        lastWrittenAt: "2026-09-27T10:00:00+00:00",
        slug: "draft",
        title: "Draft",
        writers: [writer("Mia")],
      },
    ],
    observedAt: "2026-09-27T10:00:30.000Z",
  };

  it("accepts a snapshot from the activity endpoint", () => {
    expect(writingActivitySnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it.each([
    ["an unreadable timestamp", { ...snapshot, observedAt: "yesterday" }],
    [
      "a document without writers",
      { ...snapshot, documents: [{ ...snapshot.documents[0], writers: [] }] },
    ],
    ["a missing document list", { observedAt: snapshot.observedAt }],
  ])("rejects %s", (_, value) => {
    expect(writingActivitySnapshotSchema.safeParse(value).success).toBe(false);
  });
});
