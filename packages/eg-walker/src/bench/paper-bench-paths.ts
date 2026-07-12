import { resolve } from "node:path";

export const paperRootFromPackageRoot = (packageRoot: string): string =>
  resolve(packageRoot, "../../..", "egwalker-paper");
