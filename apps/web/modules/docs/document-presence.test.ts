// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { domPointAtOffset } from "./document-presence-dom";

describe("remote presence DOM mapping", () => {
  it("maps a block offset through nested inline nodes", () => {
    const block = document.createElement("p");
    block.append("abc");
    const mark = document.createElement("strong");
    mark.append("def");
    block.append(mark, "ghi");

    const point = domPointAtOffset(block, 5);

    expect(point.node.textContent).toBe("def");
    expect(point.offset).toBe(2);
  });

  it("clamps an offset beyond the block to its final text node", () => {
    const block = document.createElement("p");
    block.append("final");
    const point = domPointAtOffset(block, 99);
    expect(point.node.textContent).toBe("final");
    expect(point.offset).toBe(5);
  });
});
