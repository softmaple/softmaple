import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cachedGetPublicDocumentBySlug } from "@/app/actions/documents/documents";
import { DocumentEditor } from "@/modules/docs/document-editor";

type Props = { params: Promise<{ docSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { docSlug } = await params;
  const document = await cachedGetPublicDocumentBySlug(docSlug);
  return {
    title: document.ok ? document.data.title : "Shared document",
    description: "A read-only document shared from Softmaple",
    robots: { follow: false, index: false },
  };
}

export default async function SharedDocumentPage({ params }: Props) {
  const { docSlug } = await params;
  const document = await cachedGetPublicDocumentBySlug(docSlug);
  if (!document.ok) notFound();

  return (
    <DocumentEditor
      docSlug={document.data.slug}
      documentId={document.data.id}
      publicView
      title={document.data.title}
    />
  );
}
