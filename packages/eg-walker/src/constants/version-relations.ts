/**
 * Version comparison constants for event graph relationships.
 * These represent the possible relationships between versions.
 */

export const VERSION_RELATION = {
  EQUAL: "equal",
  ANCESTOR: "ancestor",
  DESCENDANT: "descendant",
  CONCURRENT: "concurrent",
} as const;

export type VersionRelation =
  (typeof VERSION_RELATION)[keyof typeof VERSION_RELATION];
