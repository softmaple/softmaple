import { randomBytes } from "node:crypto";

const NON_SLUG_CHARACTER = /[^a-z0-9]+/g;
const EDGE_HYPHEN = /^-+|-+$/g;
const MAX_PREFIX_LENGTH = 48;

export const slugifyTitle = (title: string): string => {
  const normalized = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(NON_SLUG_CHARACTER, "-")
    .replace(EDGE_HYPHEN, "")
    .slice(0, MAX_PREFIX_LENGTH)
    .replace(EDGE_HYPHEN, "");
  return normalized || "untitled";
};

export const createStableSlug = (
  title: string,
  suffix = randomBytes(6).toString("hex"),
): string => `${slugifyTitle(title)}-${suffix}`;
