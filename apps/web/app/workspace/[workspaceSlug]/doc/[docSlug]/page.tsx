import { DocumentEditor } from "@/modules/docs/document-editor";
import type { Metadata, ResolvingMetadata } from "next";
import { cachedGetDocumentBySlug } from "@/app/actions/documents/documents";
import { notFound } from "next/navigation";
import { getWorkspaceMemberByUserId } from "@/app/actions/workspaceMembers";

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

  if (isNewDoc) {
    // Redirect to create a new document
    return <DocumentEditor title={DEFAULT_TITLE} content="" />;
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
    />
  );
}
