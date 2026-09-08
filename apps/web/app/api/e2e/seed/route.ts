import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DOCUMENT_FIXTURES,
  FIXTURE_KIND,
  fixtureEventBatches,
} from "@/lib/seeding/seed-fixtures";
import { resolveSeedConfiguration } from "@/lib/seeding/seed-isolation";
import type { ServiceRoleDatabase } from "@/lib/seeding/service-role-rpc";
import type { Database } from "@/types/model";

const requestSchema = z.object({
  action: z.union([z.literal("seed"), z.literal("cleanup")]),
  runId: z.string().regex(/^[a-z0-9-]{8,48}$/),
});

const configuration = () =>
  resolveSeedConfiguration(
    process.env as Readonly<Record<string, string | undefined>>,
  );

const runEmails = (runId: string) => ({
  editor: `e2e+${runId}-editor@softmaple.invalid`,
  owner: `e2e+${runId}-owner@softmaple.invalid`,
  viewer: `e2e+${runId}-viewer@softmaple.invalid`,
});

export async function POST(request: Request) {
  let config;
  try {
    config = configuration();
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  if (request.headers.get("authorization") !== `Bearer ${config.seedSecret}`) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid seed request" },
      { status: 400 },
    );
  }

  const clientOptions = {
    auth: { autoRefreshToken: false, persistSession: false },
  } as const;
  const admin = createClient<Database>(
    config.url,
    config.serviceRoleKey,
    clientOptions,
  );
  // A second view of the same connection, typed for the service-role-only
  // functions the Data API never exposes to a browser.
  const collabRpc = createClient<ServiceRoleDatabase>(
    config.url,
    config.serviceRoleKey,
    clientOptions,
  );
  const emails = runEmails(parsed.data.runId);
  if (parsed.data.action === "cleanup") {
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
    if (users.error !== null) {
      return NextResponse.json(
        { error: "Cleanup lookup failed" },
        { status: 500 },
      );
    }
    const exactEmails = new Set(Object.values(emails));
    const targets = users.data.users.filter(
      (user) => user.email !== undefined && exactEmails.has(user.email),
    );
    for (const user of targets) {
      const result = await admin.auth.admin.deleteUser(user.id);
      if (result.error !== null) {
        return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
      }
    }
    return NextResponse.json({ deletedUsers: targets.length });
  }

  const password = `E2E-${randomBytes(12).toString("base64url")}9a`;
  const createUser = async (email: string, fullName: string) =>
    admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
      user_metadata: { full_name: fullName },
    });
  const owner = await createUser(emails.owner, "E2E Owner");
  if (owner.error !== null || owner.data.user === null) {
    return NextResponse.json({ error: "Owner seed failed" }, { status: 500 });
  }
  const editor = await createUser(emails.editor, "E2E Editor");
  if (editor.error !== null || editor.data.user === null) {
    await admin.auth.admin.deleteUser(owner.data.user.id);
    return NextResponse.json({ error: "Editor seed failed" }, { status: 500 });
  }
  const viewer = await createUser(emails.viewer, "E2E Viewer");
  if (viewer.error !== null || viewer.data.user === null) {
    await Promise.all([
      admin.auth.admin.deleteUser(owner.data.user.id),
      admin.auth.admin.deleteUser(editor.data.user.id),
    ]);
    return NextResponse.json({ error: "Viewer seed failed" }, { status: 500 });
  }

  const suffix = randomBytes(6).toString("hex");
  const workspace = await admin
    .from("workspaces")
    .insert({
      description: `Isolated Playwright run ${parsed.data.runId}`,
      owner_id: owner.data.user.id,
      slug: `e2e-${parsed.data.runId}-${suffix}`,
      title: `E2E Workspace ${parsed.data.runId}`,
    })
    .select("id, slug, title")
    .single();
  if (workspace.error !== null) {
    await Promise.all([
      admin.auth.admin.deleteUser(owner.data.user.id),
      admin.auth.admin.deleteUser(editor.data.user.id),
      admin.auth.admin.deleteUser(viewer.data.user.id),
    ]);
    return NextResponse.json(
      { error: "Workspace seed failed" },
      { status: 500 },
    );
  }
  // Owner-only workspace: trigger adds the owner member; viewer/editor stay out.
  const ownerOnlyWorkspace = await admin
    .from("workspaces")
    .insert({
      description: `Owner-only Playwright run ${parsed.data.runId}`,
      owner_id: owner.data.user.id,
      slug: `e2e-owner-only-${parsed.data.runId}-${suffix}`,
      title: `E2E Owner Only ${parsed.data.runId}`,
    })
    .select("id, slug, title")
    .single();
  if (ownerOnlyWorkspace.error !== null) {
    await Promise.all([
      admin.auth.admin.deleteUser(owner.data.user.id),
      admin.auth.admin.deleteUser(editor.data.user.id),
      admin.auth.admin.deleteUser(viewer.data.user.id),
    ]);
    return NextResponse.json(
      { error: "Owner-only workspace seed failed" },
      { status: 500 },
    );
  }

  // A workspace every role can open but that holds no documents, so the empty
  // state is reachable without deleting seeded content first.
  const emptyWorkspace = await admin
    .from("workspaces")
    .insert({
      description: `Empty Playwright run ${parsed.data.runId}`,
      owner_id: owner.data.user.id,
      slug: `e2e-empty-${parsed.data.runId}-${suffix}`,
      title: `E2E Empty ${parsed.data.runId}`,
    })
    .select("id, slug, title")
    .single();
  if (emptyWorkspace.error !== null) {
    await Promise.all([
      admin.auth.admin.deleteUser(owner.data.user.id),
      admin.auth.admin.deleteUser(editor.data.user.id),
      admin.auth.admin.deleteUser(viewer.data.user.id),
    ]);
    return NextResponse.json(
      { error: "Empty workspace seed failed" },
      { status: 500 },
    );
  }

  const membership = await admin.from("workspace_members").insert([
    {
      invited_by: owner.data.user.id,
      role: "EDITOR",
      user_id: editor.data.user.id,
      workspace_id: workspace.data.id,
    },
    {
      invited_by: owner.data.user.id,
      role: "VIEWER",
      user_id: viewer.data.user.id,
      workspace_id: workspace.data.id,
    },
    {
      invited_by: owner.data.user.id,
      role: "EDITOR",
      user_id: editor.data.user.id,
      workspace_id: emptyWorkspace.data.id,
    },
  ]);
  const documents = await admin
    .from("documents")
    .insert(
      DOCUMENT_FIXTURES.map((fixture) => ({
        author_id: owner.data.user.id,
        is_public: fixture.isPublic,
        slug: `${fixture.slug}-${suffix}`,
        title: fixture.title,
        workspace_id: workspace.data.id,
      })),
    )
    .select("id, slug, title, is_public");

  const removeSeededUsers = async () => {
    await Promise.all([
      admin.auth.admin.deleteUser(owner.data.user.id),
      admin.auth.admin.deleteUser(editor.data.user.id),
      admin.auth.admin.deleteUser(viewer.data.user.id),
    ]);
  };

  if (membership.error !== null || documents.error !== null) {
    await removeSeededUsers();
    return NextResponse.json(
      { error: "Workspace data seed failed" },
      { status: 500 },
    );
  }

  // Rows come back in insert order, so a fixture and its row stay paired.
  const seeded = DOCUMENT_FIXTURES.map((fixture, index) => ({
    fixture,
    row: documents.data[index],
  }));

  for (const { fixture, row } of seeded) {
    if (row === undefined) {
      await removeSeededUsers();
      return NextResponse.json(
        { error: "Document seed failed" },
        { status: 500 },
      );
    }
    const batches = fixtureEventBatches(fixture, `seed-${suffix}`);
    // The same RPC the collaboration runtime uses, so seeded history is
    // indistinguishable from history a browser wrote.
    const appended = await collabRpc.rpc("append_document_event_batches", {
      p_actor_id: owner.data.user.id,
      p_batches: batches,
      p_document_id: row.id,
    });
    if (appended.error !== null) {
      await removeSeededUsers();
      return NextResponse.json(
        { error: "Document content seed failed" },
        { status: 500 },
      );
    }
  }

  const documentByKind = Object.fromEntries(
    seeded.map(({ fixture, row }) => [fixture.kind, row]),
  );

  return NextResponse.json({
    /** Kept for existing specs: the private draft in the shared workspace. */
    document: documentByKind[FIXTURE_KIND.Draft],
    documents: documentByKind,
    editor: { email: emails.editor, password },
    emptyWorkspace: emptyWorkspace.data,
    owner: { email: emails.owner, password },
    ownerOnlyWorkspace: ownerOnlyWorkspace.data,
    viewer: { email: emails.viewer, password },
    workspace: workspace.data,
  });
}
