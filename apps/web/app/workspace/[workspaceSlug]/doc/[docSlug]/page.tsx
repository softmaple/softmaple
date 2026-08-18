import type { Metadata } from "next";
import { resolveDocumentCollabTarget } from "@/modules/docs/collab-target.server";
import { DocumentEditor } from "@/modules/docs/document-editor";
import { NewDocumentForm } from "@/modules/docs/new-document-form";
import { cachedGetDocumentBySlug } from "@/app/actions/documents/documents";
import { getWorkspaceMemberByUserId } from "@/app/actions/workspaceMembers";
import { cachedGetWorkspaceBySlug } from "@/app/actions/workspaces";
import { getCurrentUser } from "@/app/actions/auth";
import { getCurrentProfile } from "@/app/actions/users";
import { requireWorkspaceRouteData } from "@/lib/actions/workspace-route";

type Props = {
  params: Promise<{ docSlug: string; workspaceSlug: string }>;
};

const ROUTE = "/workspace/[workspaceSlug]/doc/[docSlug]";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { docSlug, workspaceSlug } = await params;
  if (docSlug === "new") {
    return { title: "New document", description: "Create a document" };
  }
  const document = await cachedGetDocumentBySlug(workspaceSlug, docSlug);
  return {
    title: document.ok ? document.data.title : "Document",
    description: "Collaborative document in Softmaple",
  };
}

export default async function DocumentPage({ params }: Props) {
  const { docSlug, workspaceSlug } = await params;

  if (docSlug === "new") {
    return <NewDocumentForm workspaceSlug={workspaceSlug} />;
  }

  const failureContext = {
    loginNext: `/workspace/${workspaceSlug}/doc/${docSlug}`,
    route: ROUTE,
    workspaceSlug,
  } as const;

  const [workspaceResult, userResult, profileResult] = await Promise.all([
    cachedGetWorkspaceBySlug(workspaceSlug),
    getCurrentUser(),
    getCurrentProfile(),
  ]);

  const workspace = requireWorkspaceRouteData(workspaceResult, {
    ...failureContext,
    operation: "get_workspace_by_slug",
  });
  const user = requireWorkspaceRouteData(userResult, {
    ...failureContext,
    operation: "get_current_user",
  });
  const profile = requireWorkspaceRouteData(profileResult, {
    ...failureContext,
    operation: "get_current_profile",
  });

  const [documentResult, membershipResult] = await Promise.all([
    cachedGetDocumentBySlug(workspaceSlug, docSlug),
    getWorkspaceMemberByUserId(workspace.id),
  ]);

  const document = requireWorkspaceRouteData(documentResult, {
    ...failureContext,
    operation: "get_document_by_slug",
  });
  const membership = requireWorkspaceRouteData(membershipResult, {
    ...failureContext,
    operation: "get_workspace_member_by_user_id",
  });

  // Runtime ownership and its endpoints are decided here, on the server; the
  // browser connects to exactly this target and never picks another runtime.
  const collabTarget = await resolveDocumentCollabTarget(document.id);

  return (
    <DocumentEditor
      authorId={document.author_id}
      avatarUrl={profile.avatar_src}
      collabTarget={collabTarget}
      currentUserId={user.id}
      docSlug={document.slug}
      documentId={document.id}
      isPublic={document.is_public}
      role={membership.role}
      title={document.title}
      userName={profile.full_name?.trim() || "Workspace member"}
      workspaceSlug={workspaceSlug}
    />
  );
}
