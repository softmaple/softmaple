import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { paperRootFromPackageRoot } from "../bench/paper-bench-paths";

describe("paperRootFromPackageRoot", () => {
  it("should locate the paper artifact independently of the process cwd", () => {
    // Arrange
    const packageRoot = resolve("/workspace/softmaple/packages/bench");

    // Act
    const paperRoot = paperRootFromPackageRoot(packageRoot);

    // Assert
    expect(paperRoot).toBe(resolve("/workspace/egwalker-paper"));
  });
});
