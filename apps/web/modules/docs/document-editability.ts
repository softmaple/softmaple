export type DocumentPermission = "owner" | "editor" | "viewer";

export type DocumentSessionMode = "authenticated" | "public";

/**
 * Editor editability depends only on document access permissions.
 * Save status and collaboration connection state must never affect this.
 */
export const isDocumentEditable = ({
  permission,
  sessionMode,
}: {
  readonly permission: DocumentPermission | null;
  readonly sessionMode: DocumentSessionMode;
}): boolean => {
  if (sessionMode !== "authenticated" || permission === null) return false;
  return permission === "owner" || permission === "editor";
};

export const permissionFromRole = (
  role: "OWNER" | "EDITOR" | "VIEWER" | null | undefined,
): DocumentPermission | null => {
  if (role === "OWNER") return "owner";
  if (role === "EDITOR") return "editor";
  if (role === "VIEWER") return "viewer";
  return null;
};
