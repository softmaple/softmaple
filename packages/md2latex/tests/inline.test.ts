import { describe, expect } from "vitest";
import { markdownToLatex } from "../src/md2latex";

describe("inline", () => {
  const mdStr = `**bold**`;
  const tex = markdownToLatex(mdStr);
  expect(tex).toBe(`\\textbf{bold}`);
});
