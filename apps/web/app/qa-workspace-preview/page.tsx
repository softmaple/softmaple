import { notFound } from "next/navigation";
import { WorkspaceHome } from "@/modules/workspaces/workspace-home";
import { homeFixture } from "@/modules/workspaces/home-fixture";

export const metadata = {
  title: "Workspace visual fixture",
  robots: { index: false, follow: false },
};
/** Isolated fixture cannot be accessed in production or imply real activity. */
export default async function WorkspacePreview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  // Dev-only fixture; this deployment guard does not affect build outputs.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  if (process.env.NODE_ENV !== "development") notFound();
  const { state } = await searchParams;
  const props =
    state === "empty"
      ? {
          ...homeFixture,
          documents: [],
          documentCount: 0,
          members: [],
          visualFixture: false,
        }
      : state === "long"
        ? {
            ...homeFixture,
            visualFixture: false,
            documents: homeFixture.documents.map((document) => ({
              ...document,
              title:
                "A very long document title that should wrap or truncate gracefully without obscuring the document actions or moving the navigation",
              preview: undefined,
            })),
          }
        : homeFixture;
  return <WorkspaceHome {...props} />;
}
