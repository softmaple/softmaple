import { describe, expect, it } from "vitest";

import { sectionTitles, splitFigures } from "@/components/paper/paper-segments";
import { PAPER_SOURCE } from "@/components/paper/paper-source";

describe("splitFigures", () => {
  it("returns the source unchanged when it holds no figure", () => {
    expect(splitFigures("Just prose.\n\n# A heading")).toEqual([
      { kind: "prose", markdown: "Just prose.\n\n# A heading" },
    ]);
  });

  it("lifts a figure out and keeps the prose either side of it", () => {
    const source =
      "Before.\n\n```figure:presence\nFigure 1. A caption.\n```\n\nAfter.";
    expect(splitFigures(source)).toEqual([
      { kind: "prose", markdown: "Before." },
      { caption: "Figure 1. A caption.", id: "presence", kind: "figure" },
      { kind: "prose", markdown: "After." },
    ]);
  });

  it("keeps every figure in the real paper, in order", () => {
    const figures = splitFigures(PAPER_SOURCE).filter(
      (segment) => segment.kind === "figure",
    );
    expect(figures.map((figure) => figure.id)).toEqual([
      "presence",
      "convergence",
    ]);
  });

  it("loses no prose from the real paper", () => {
    const rejoined = splitFigures(PAPER_SOURCE)
      .filter((segment) => segment.kind === "prose")
      .map((segment) => segment.markdown)
      .join("\n\n");
    expect(rejoined).toContain("Softmaple removes the turn.");
    expect(rejoined).toContain("What you actually get");
    expect(rejoined).not.toContain("```");
  });
});

describe("sectionTitles", () => {
  it("lists the paper's sections in reading order", () => {
    expect(sectionTitles(PAPER_SOURCE)).toEqual([
      "Turn-taking is a storage decision, not a social one",
      "A document is a history, not a file",
      "Four ways to read the same history",
      "What you actually get",
    ]);
  });
});
