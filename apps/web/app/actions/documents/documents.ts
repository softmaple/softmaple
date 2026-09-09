"use server";

import { cache } from "react";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { DocsType, PublicDocumentRow } from "@/types/model";
import { createStableSlug } from "@/lib/slug";
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
  options: { readonly offset?: number; readonly title?: string } = {},
): Promise<ActionResult<DocumentRow[]>> => {
  const parsed = z
    .object({
      limit: z.number().int().min(1).max(100),
      offset: z.number().int().min(0).max(100_000),
      title: z.string().trim().max(160),
      workspaceId: z.number().int().positive(),
    })
    .safeParse({
      limit,
      workspaceId,
      offset: options.offset ?? 0,
      title: options.title ?? "",
    });
  if (!parsed.success) return fromZodError(parsed.error);

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  let query = context.data.supabase
    .from("documents")
    .select("*")
    .eq("workspace_id", parsed.data.workspaceId);
  if (parsed.data.title.length > 0)
    query = query.ilike(
      "title",
      `%${parsed.data.title.replace(/[\\%_]/g, "\\$&")}%`,
    );
  const { data, error } = await query
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1);
  if (error !== null) {
    return fromDatabaseError(error, "Could not load workspace documents.");
  }
  return actionSuccess(data);
};

/** Title-only search over authorized workspace documents; never filters a partial cache. */
export const searchWorkspaceDocuments = async (
  workspaceSlug: string,
  options: { readonly offset?: number; readonly title?: string } = {},
): Promise<ActionResult<DocumentRow[]>> => {
  const parsed = z.string().trim().min(1).max(200).safeParse(workspaceSlug);
  if (!parsed.success) return fromZodError(parsed.error);
  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const { data, error } = await context.data.supabase
    .from("workspaces")
    .select("id")
    .eq("slug", parsed.data)
    .maybeSingle();
  if (error !== null)
    return fromDatabaseError(error, "Could not search this workspace.");
  if (data === null)
    return actionFailure(ACTION_ERROR_CODE.NotFound, "Workspace not found.");
  return listWorkspaceDocuments(data.id, 25, options);
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
