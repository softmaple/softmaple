import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocumentEditor } from "@/modules/docs/document-editor";
import { NewDocumentForm } from "@/modules/docs/new-document-form";
import { cachedGetDocumentBySlug } from "@/app/actions/documents/documents";
import { getWorkspaceMemberByUserId } from "@/app/actions/workspaceMembers";
import { cachedGetWorkspaceBySlug } from "@/app/actions/workspaces";
import { getCurrentUser } from "@/app/actions/auth";
import { getCurrentProfile } from "@/app/actions/users";

type Props = {
  params: Promise<{ docSlug: string; workspaceSlug: string }>;
};

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
  const [workspace, user, profile] = await Promise.all([
    cachedGetWorkspaceBySlug(workspaceSlug),
    getCurrentUser(),
    getCurrentProfile(),
  ]);
  if (!workspace.ok || !user.ok || !profile.ok) notFound();

  if (docSlug === "new") {
    return <NewDocumentForm workspaceSlug={workspaceSlug} />;
  }

  const [document, membership] = await Promise.all([
    cachedGetDocumentBySlug(workspaceSlug, docSlug),
    getWorkspaceMemberByUserId(workspace.data.id),
  ]);
  if (!document.ok || !membership.ok) notFound();

  return (
    <DocumentEditor
      authorId={document.data.author_id}
      avatarUrl={profile.data.avatar_src}
      currentUserId={user.data.id}
      docSlug={document.data.slug}
      documentId={document.data.id}
      isPublic={document.data.is_public}
      role={membership.data.role}
      title={document.data.title}
      userName={profile.data.full_name?.trim() || "Workspace member"}
      workspaceSlug={workspaceSlug}
    />
  );
}
