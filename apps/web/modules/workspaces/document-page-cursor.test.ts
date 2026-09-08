import { describe, expect, it } from "vitest";
import {
  decodeDocumentPageCursor,
  documentPageFilter,
  encodeDocumentPageCursor,
  escapeTitleFilter,
  nextDocumentPageCursor,
} from "@/modules/workspaces/document-page-cursor";

describe("cursor encoding", () => {
  it("round-trips a timestamped cursor", () => {
    const cursor = { updatedAt: "2026-01-02T03:04:05.000Z", id: "doc-1" };
    expect(decodeDocumentPageCursor(encodeDocumentPageCursor(cursor))).toEqual(
      cursor,
    );
  });

  it("round-trips a never-updated document", () => {
    const cursor = { updatedAt: null, id: "doc-1" };
    expect(decodeDocumentPageCursor(encodeDocumentPageCursor(cursor))).toEqual(
      cursor,
    );
  });

  it("returns null for anything malformed, rather than throwing", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "|",
      "|doc",
      "nonsense|doc",
      "abc",
    ]) {
      expect(decodeDocumentPageCursor(raw)).toBeNull();
    }
  });

  it("keeps an id that itself contains the separator", () => {
    const cursor = { updatedAt: null, id: "doc|with|pipes" };
    expect(decodeDocumentPageCursor(encodeDocumentPageCursor(cursor))).toEqual(
      cursor,
    );
  });
});

describe("documentPageFilter", () => {
  it("continues past a timestamp, its ties, and into the null tail", () => {
    expect(
      documentPageFilter({ updatedAt: "2026-01-02T03:04:05.000Z", id: "d1" }),
    ).toBe(
      "updated_at.lt.2026-01-02T03:04:05.000Z," +
        "and(updated_at.eq.2026-01-02T03:04:05.000Z,id.lt.d1)," +
        "updated_at.is.null",
    );
  });

  it("stays inside the null tail once it is there", () => {
    expect(documentPageFilter({ updatedAt: null, id: "d1" })).toBe(
      "and(updated_at.is.null,id.lt.d1)",
    );
  });
});

describe("nextDocumentPageCursor", () => {
  const row = (id: string, updated_at: string | null) => ({ id, updated_at });

  it("is null on a short page, which is the last page", () => {
    expect(nextDocumentPageCursor([row("a", null)], 25)).toBeNull();
  });

  it("names the last row of a full page", () => {
    const page = [row("a", "2026-01-02T00:00:00.000Z"), row("b", null)];
    expect(nextDocumentPageCursor(page, 2)).toEqual({
      updatedAt: null,
      id: "b",
    });
  });

  it("is null for an empty page", () => {
    expect(nextDocumentPageCursor([], 25)).toBeNull();
  });
});

describe("escapeTitleFilter", () => {
  it("neutralises wildcards and clause separators", () => {
    expect(escapeTitleFilter("100%_done, really(!)")).toBe(
      "100\\%\\_done\\, really\\(!\\)",
    );
  });

  it("escapes a backslash before it can escape something else", () => {
    expect(escapeTitleFilter("a\\%b")).toBe("a\\\\\\%b");
  });

  it("trims surrounding space", () => {
    expect(escapeTitleFilter("  notes  ")).toBe("notes");
  });
});
