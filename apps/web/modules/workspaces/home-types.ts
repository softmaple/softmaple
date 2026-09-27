import type { DocsType, UsersType } from "@/types/model";
import type { WorkspaceMemberDirectoryEntry } from "@/lib/workspace-roles";
import type { WorkspaceSummary } from "@/app/actions/workspaces";
import type { WritingActivitySnapshot } from "./writing-activity";

export type HomeDocument = DocsType["Row"] & {
  /** Only the isolated visual fixture supplies excerpts and collaborators. */
  preview?: string;
  displayTime?: string;
  space?: "Product" | "Ideas" | "Personal";
  people?: ReadonlyArray<HomePerson>;
};
export type HomePerson = { full_name: string; avatar_src: string | null };
export type HomeProps = {
  /** Writing activity at render time; `null` when it could not be read. */
  activity: WritingActivitySnapshot | null;
  documents: ReadonlyArray<HomeDocument>;
  members: ReadonlyArray<WorkspaceMemberDirectoryEntry>;
  workspaces: ReadonlyArray<WorkspaceSummary>;
  workspaceId: number;
  workspaceSlug: string;
  canEdit: boolean;
  profile: Pick<UsersType["Row"], "id" | "full_name" | "email" | "avatar_src">;
  documentCount: number;
  /** Never supplied by the authenticated workspace route. */
  visualFixture?: boolean;
};
