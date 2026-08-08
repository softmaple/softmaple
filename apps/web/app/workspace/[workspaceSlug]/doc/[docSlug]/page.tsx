import { DocumentEditor } from "@/modules/docs/document-editor";
import type { Metadata, ResolvingMetadata } from "next";
import {
  cachedGetDocumentBySlug,
  createDocument,
} from "@/app/actions/documents/documents";
import { notFound, redirect } from "next/navigation";
import { getWorkspaceMemberByUserId } from "@/app/actions/workspaceMembers";
import { cachedGetWorkspaceBySlug } from "@/app/actions/workspaces";
import { getCurrentUser } from "@/app/actions/auth";

const DEFAULT_TITLE = "Untitled Document";

type Props = {
  params: Promise<{ docSlug: string; workspaceSlug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const createSlug = (title: string): string => {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "document"}-${Date.now()}`;
};

export async function generateMetadata(
  { params }: Props,
  _parent: ResolvingMetadata,
): Promise<Metadata> {
  const { docSlug } = await params;

  if (docSlug === "new") {
    return {
      title: DEFAULT_TITLE,
      description: "Creating a new document",
    };
  }

  const { data: currentDoc } = await cachedGetDocumentBySlug(docSlug);
  return {
    title: currentDoc?.title ?? DEFAULT_TITLE,
    description: "Softmaple collaborative document",
  };
}

export default async function DocumentPage({ params }: Props) {
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

  const { data: workspaceMember, error: workspaceMemberError } =
    await getWorkspaceMemberByUserId(workspace.id);

  if (workspaceMemberError) {
    throw workspaceMemberError;
  }

  if (!workspaceMember) {
    notFound();
  }

  // Create the Document row first so the collab editor always has a UUID room key.
  if (isNewDoc) {
    const slug = createSlug(DEFAULT_TITLE);
    const { data: created, error: createError } = await createDocument({
      title: DEFAULT_TITLE,
      slug,
      workspace_id: workspace.id,
      author_id: user.id,
      markdown_content: null,
    });

    if (createError || !created) {
      console.error("Error creating document:", createError);
      throw createError ?? new Error("Failed to create document");
    }

    redirect(`/workspace/${workspaceSlug}/doc/${created.slug}`);
  }

  const { data: currentDoc, error } = await cachedGetDocumentBySlug(docSlug);

  if (error) {
    console.error("Error fetching workspace doc:", error);
    throw error;
  }

  if (!currentDoc) {
    notFound();
  }

  const { title = DEFAULT_TITLE, id: documentId } = currentDoc;

  return (
    <DocumentEditor
      title={title}
      content=""
      docSlug={docSlug}
      documentId={documentId}
      isNewDoc={false}
      workspaceId={workspace.id}
      userId={user.id}
    />
  );
}
