import { DocumentEditor } from "@/modules/docs/document-editor";
import type { Metadata, ResolvingMetadata } from "next";
import { cachedGetDocumentBySlug } from "@/app/actions/documents/documents";
import { notFound } from "next/navigation";
import { getWorkspaceMemberByUserId } from "@/app/actions/workspaceMembers";
import { cachedGetWorkspaceBySlug } from "@/app/actions/workspaces";
import { getCurrentUser } from "@/app/actions/auth";

const DEFAULT_TITLE = "Untitled Document";

type Props = {
  params: Promise<{ docSlug: string; workspaceSlug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata(
  { params, searchParams }: Props,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { docSlug } = await params;

  const isNewDoc = docSlug === "new";

  if (isNewDoc) {
    return {
      title: DEFAULT_TITLE,
      description: "Creating a new document",
    };
  }

  // fetch current doc information
  const { data: currentDoc } = await cachedGetDocumentBySlug(docSlug);

  const { title, markdown_content } = currentDoc || {};

  return {
    title,
    description: markdown_content?.substring(0, 150) || "Document content",
  };
}

export default async function DocumentPage({ params, searchParams }: Props) {
  const { docSlug, workspaceSlug } = await params;

  const isNewDoc = docSlug === "new";

  const { data: workspace, error: workspaceError } =
    await cachedGetWorkspaceBySlug(workspaceSlug);

  if (workspaceError) {
    console.error("Error fetching workspace:", workspaceError);
    throw workspaceError;
  }

  if (!workspace) {
    notFound();
  }

  const { data: userData, error: userError } = await getCurrentUser();

  const { user } = userData || {};

  if (userError) {
    console.error("Error fetching current user:", userError);
    throw userError;
  }

  if (!user) {
    notFound();
  }

  if (isNewDoc) {
    // Redirect to create a new document
    return (
      <DocumentEditor
        isNewDoc
        title={DEFAULT_TITLE}
        content=""
        workspaceId={workspace.id}
        userId={user.id}
      />
    );
  }

  const { data: currentDoc, error } = await cachedGetDocumentBySlug(docSlug);

  if (error) {
    console.error("Error fetching workspace doc:", error);
    throw error;
  }

  if (!currentDoc) {
    notFound();
  }

  const {
    title = DEFAULT_TITLE,
    markdown_content,
    is_public = false,
  } = currentDoc || {};

  const { data: workspaceMember, error: workspaceMemberError } =
    await getWorkspaceMemberByUserId();

  if (workspaceMemberError) {
    throw workspaceMemberError;
  }

  if (!workspaceMember) {
    notFound();
  }

  // TODO: it would be readonly if the user is the `viewer` role.
  const { role: userRole } = workspaceMember;

  return (
    <DocumentEditor
      title={title}
      content={markdown_content || ""}
      docSlug={docSlug}
      isPublic={is_public || false}
      isNewDoc={false}
      workspaceId={workspace.id}
      userId={user.id}
    />
  );
}
