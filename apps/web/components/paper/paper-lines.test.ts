import { describe, expect, it } from "vitest";

import { lineTone, toSourceLines } from "@/components/paper/paper-lines";

describe("lineTone", () => {
  it("accents the lines that open a Markdown block", () => {
    expect(lineTone("# A section", "markdown")).toBe("accent");
    expect(lineTone("```figure:presence", "markdown")).toBe("accent");
  });

  it("mutes quoted and listed lines", () => {
    expect(lineTone("> A pull quote", "markdown")).toBe("muted");
    expect(lineTone("- An item", "markdown")).toBe("muted");
  });

  it("accents LaTeX control sequences only", () => {
    expect(lineTone("\\section{Turn-taking}", "latex")).toBe("accent");
    expect(lineTone("Plain body text.", "latex")).toBe("body");
    expect(lineTone("# not a heading here", "latex")).toBe("body");
  });

  it("treats a blank line as body rather than guessing", () => {
    expect(lineTone("", "markdown")).toBe("body");
    expect(lineTone("   ", "latex")).toBe("body");
  });
});

describe("toSourceLines", () => {
  it("keeps interior blank lines and drops only the trailing newline", () => {
    expect(toSourceLines("a\n\nb\n", "markdown")).toEqual([
      { text: "a", tone: "body" },
      { text: "", tone: "body" },
      { text: "b", tone: "body" },
    ]);
  });
});
