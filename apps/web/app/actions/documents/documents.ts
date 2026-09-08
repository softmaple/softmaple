"use server";

import { cache } from "react";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { DocsType, PublicDocumentRow } from "@/types/model";
import { createStableSlug } from "@/lib/slug";
import {
  decodeDocumentPageCursor,
  documentPageFilter,
  encodeDocumentPageCursor,
  escapeTitleFilter,
  nextDocumentPageCursor,
} from "@/modules/workspaces/document-page-cursor";
import { getAuthenticatedContext } from "@/lib/actions/authenticated";
import { createClient } from "@/utils/supabase/server";
import {
  ACTION_ERROR_CODE,
  actionFailure,
  actionSuccess,
  fromDatabaseError,
  fromZodError,
  type ActionResult,
} from "@/lib/actions/result";

type DocumentRow = DocsType["Row"];

const documentLocationSchema = z.object({
  docSlug: z.string().trim().min(1),
  workspaceSlug: z.string().trim().min(1),
});
const documentTitleSchema = documentLocationSchema.extend({
  title: z.string().trim().min(1, "Document title is required.").max(160),
});
const createDocumentSchema = z.object({
  title: z.string().trim().min(1, "Document title is required.").max(160),
  workspaceSlug: z.string().trim().min(1),
});
const documentIdSchema = z.object({
  documentId: z.uuid(),
  docSlug: z.string().trim().min(1),
  workspaceSlug: z.string().trim().min(1),
});
const sharingSchema = documentIdSchema.extend({ enabled: z.boolean() });

const readDocument = async (
  workspaceSlug: string,
  docSlug: string,
): Promise<ActionResult<DocumentRow>> => {
  const context = await getAuthenticatedContext();
  if (!context.ok) return context;

  const { data: workspace, error: workspaceError } = await context.data.supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  if (workspaceError !== null) {
    return fromDatabaseError(workspaceError, "Could not load the workspace.");
  }
  if (workspace === null) {
    return actionFailure(ACTION_ERROR_CODE.NotFound, "Workspace not found.");
  }

  const { data, error } = await context.data.supabase
    .from("documents")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("slug", docSlug)
    .maybeSingle();
  if (error !== null) {
    return fromDatabaseError(error, "Could not load the document.");
  }
  if (data === null) {
    return actionFailure(ACTION_ERROR_CODE.NotFound, "Document not found.");
  }
  return actionSuccess(data);
};

export const getDocumentBySlug = async (
  workspaceSlug: string,
  docSlug: string,
): Promise<ActionResult<DocumentRow>> => {
  const parsed = documentLocationSchema.safeParse({ docSlug, workspaceSlug });
  if (!parsed.success) return fromZodError(parsed.error);
  return readDocument(parsed.data.workspaceSlug, parsed.data.docSlug);
};

export const cachedGetDocumentBySlug = cache(getDocumentBySlug);

export const listWorkspaceDocuments = async (
  workspaceId: number,
  limit = 25,
): Promise<ActionResult<DocumentRow[]>> => {
  const parsed = z
    .object({
      limit: z.number().int().min(1).max(100),
      workspaceId: z.number().int().positive(),
    })
    .safeParse({ limit, workspaceId });
  if (!parsed.success) return fromZodError(parsed.error);

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const { data, error } = await context.data.supabase
    .from("documents")
    .select("*")
    .eq("workspace_id", parsed.data.workspaceId)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(parsed.data.limit);
  if (error !== null) {
    return fromDatabaseError(error, "Could not load workspace documents.");
  }
  return actionSuccess(data);
};

export type DocumentPage = {
  readonly documents: ReadonlyArray<DocumentRow>;
  /** Opaque cursor for the next page, or `null` when this is the last. */
  readonly nextCursor: string | null;
};

const documentPageSchema = z.object({
  cursor: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(100),
  title: z.string().trim().max(160).optional(),
  workspaceId: z.number().int().positive(),
});

export type ListWorkspaceDocumentPageInput = z.input<typeof documentPageSchema>;

/**
 * One page of a workspace's documents, optionally filtered by title.
 *
 * This replaces "load the first hundred and filter them in the browser", which
 * silently lied twice: a workspace with more than a hundred documents was
 * missing some, and searching only ever looked at the ones already loaded.
 * Filtering and paging both happen in the database now, so a match in the
 * thousandth document is still found.
 *
 * The filter is explicitly title-only. There is no full-text index here, and
 * pretending otherwise would set an expectation the query cannot meet.
 */
export const listWorkspaceDocumentPage = async (
  input: ListWorkspaceDocumentPageInput,
): Promise<ActionResult<DocumentPage>> => {
  const parsed = documentPageSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;

  let query = context.data.supabase
    .from("documents")
    .select("*")
    .eq("workspace_id", parsed.data.workspaceId);

  const title = parsed.data.title;
  if (title !== undefined && title.length > 0) {
    query = query.ilike("title", `%${escapeTitleFilter(title)}%`);
  }

  // A malformed cursor shows the first page rather than an error: a stale URL
  // should not be a dead end.
  const cursor = decodeDocumentPageCursor(parsed.data.cursor);
  if (cursor !== null) {
    query = query.or(documentPageFilter(cursor));
  }

  const { data, error } = await query
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(parsed.data.limit);

  if (error !== null) {
    return fromDatabaseError(error, "Could not load workspace documents.");
  }

  const next = nextDocumentPageCursor(data, parsed.data.limit);
  return actionSuccess({
    documents: data,
    nextCursor: next === null ? null : encodeDocumentPageCursor(next),
  });
};

export const countWorkspaceDocuments = async (
  workspaceId: number,
): Promise<ActionResult<number>> => {
  const parsed = z.number().int().positive().safeParse(workspaceId);
  if (!parsed.success) return fromZodError(parsed.error);
  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const { count, error } = await context.data.supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", parsed.data);
  if (error !== null) {
    return fromDatabaseError(error, "Could not count workspace documents.");
  }
  return actionSuccess(count ?? 0);
};

export const createDocument = async (
  input: unknown,
): Promise<ActionResult<DocumentRow>> => {
  const parsed = createDocumentSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const { data: workspace, error: workspaceError } = await context.data.supabase
    .from("workspaces")
    .select("id")
    .eq("slug", parsed.data.workspaceSlug)
    .maybeSingle();
  if (workspaceError !== null) {
    return fromDatabaseError(workspaceError, "Could not load the workspace.");
  }
  if (workspace === null) {
    return actionFailure(ACTION_ERROR_CODE.NotFound, "Workspace not found.");
  }
  const { data, error } = await context.data.supabase
    .from("documents")
    .insert({
      author_id: context.data.user.id,
      slug: createStableSlug(parsed.data.title),
      title: parsed.data.title,
      workspace_id: workspace.id,
    })
    .select("*")
    .single();
  if (error !== null) {
    return fromDatabaseError(error, "Could not create the document.");
  }

  revalidatePath(`/workspace/${parsed.data.workspaceSlug}`);
  return actionSuccess(data);
};

export const updateDocumentTitle = async (
  input: unknown,
): Promise<ActionResult<DocumentRow>> => {
  const parsed = documentTitleSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const document = await readDocument(
    parsed.data.workspaceSlug,
    parsed.data.docSlug,
  );
  if (!document.ok) return document;
  if (document.data.title === parsed.data.title) return document;

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const { data, error } = await context.data.supabase
    .from("documents")
    .update({ title: parsed.data.title })
    .eq("id", document.data.id)
    .select("*")
    .single();
  if (error !== null) {
    return fromDatabaseError(error, "Could not rename the document.");
  }
  revalidatePath(
    `/workspace/${parsed.data.workspaceSlug}/doc/${parsed.data.docSlug}`,
  );
  return actionSuccess(data);
};

export const deleteDocument = async (
  input: unknown,
): Promise<ActionResult<{ readonly docSlug: string }>> => {
  const parsed = documentIdSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const document = await readDocument(
    parsed.data.workspaceSlug,
    parsed.data.docSlug,
  );
  if (!document.ok) return document;
  if (document.data.id !== parsed.data.documentId) {
    return actionFailure(ACTION_ERROR_CODE.NotFound, "Document not found.");
  }

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const { error } = await context.data.supabase
    .from("documents")
    .delete()
    .eq("id", document.data.id);
  if (error !== null) {
    return fromDatabaseError(error, "Could not delete the document.");
  }
  revalidatePath(`/workspace/${parsed.data.workspaceSlug}`);
  return actionSuccess({ docSlug: document.data.slug });
};

export const setDocumentPublic = async (
  input: unknown,
): Promise<ActionResult<{ readonly enabled: boolean }>> => {
  const parsed = sharingSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const document = await readDocument(
    parsed.data.workspaceSlug,
    parsed.data.docSlug,
  );
  if (!document.ok) return document;
  if (document.data.id !== parsed.data.documentId) {
    return actionFailure(ACTION_ERROR_CODE.NotFound, "Document not found.");
  }

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const { error } = await context.data.supabase.rpc("set_document_public", {
    p_document_id: document.data.id,
    p_enabled: parsed.data.enabled,
  });
  if (error !== null) {
    return fromDatabaseError(error, "Could not update public sharing.");
  }
  revalidatePath(
    `/workspace/${parsed.data.workspaceSlug}/doc/${parsed.data.docSlug}`,
  );
  revalidatePath(`/share/${parsed.data.docSlug}`);
  return actionSuccess({ enabled: parsed.data.enabled });
};

export const getPublicDocumentBySlug = async (
  docSlug: string,
): Promise<ActionResult<PublicDocumentRow>> => {
  const parsed = z.string().trim().min(1).safeParse(docSlug);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_document_by_slug", {
    p_slug: parsed.data,
  });
  if (error !== null) {
    return fromDatabaseError(error, "Could not load the shared document.");
  }
  const document = data[0];
  if (document === undefined) {
    return actionFailure(ACTION_ERROR_CODE.NotFound, "Document not found.");
  }
  return actionSuccess(document);
};

export const cachedGetPublicDocumentBySlug = cache(getPublicDocumentBySlug);
