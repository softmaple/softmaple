import { isDirectionalSelectionRange } from "@softmaple/awareness";
import type { StableBlockSelection } from "@softmaple/binding-lexical";

const key = (accountId: string) => `softmaple:places:v1:${accountId}`;
const read = (accountId: string): [string, StableBlockSelection][] => {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(key(accountId)) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is [string, StableBlockSelection] =>
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          isDirectionalSelectionRange(entry[1]),
      )
      .slice(-20);
  } catch {
    return [];
  }
};

export const readRememberedPlace = (accountId: string, documentId: string) =>
  read(accountId).find(([id]) => id === documentId)?.[1] ?? null;

/** Only stable IDs are retained locally; no text or remote locations are stored. */
export const rememberPlace = (
  accountId: string,
  documentId: string,
  selection: StableBlockSelection,
) => {
  try {
    localStorage.setItem(
      key(accountId),
      JSON.stringify(
        [
          ...read(accountId).filter(([id]) => id !== documentId),
          [documentId, selection],
        ].slice(-20),
      ),
    );
  } catch {
    /* Storage restrictions must never interrupt writing. */
  }
};
