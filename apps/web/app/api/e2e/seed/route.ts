import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Database } from "@/types/model";

const requestSchema = z.object({
  action: z.union([z.literal("seed"), z.literal("cleanup")]),
  runId: z.string().regex(/^[a-z0-9-]{8,48}$/),
});

const projectRefFromUrl = (value: string): string | null => {
  try {
    const [projectRef, ...rest] = new URL(value).hostname.split(".");
    return rest.join(".") === "supabase.co" && projectRef ? projectRef : null;
  } catch {
    return null;
  }
};

const configuration = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const expectedProjectRef = process.env.E2E_SUPABASE_PROJECT_REF;
  const seedSecret = process.env.E2E_SEED_SECRET;
  const actualProjectRef = url === undefined ? null : projectRefFromUrl(url);
  if (
    process.env.E2E_ALLOW_REMOTE_SEED !== "true" ||
    url === undefined ||
    serviceRoleKey === undefined ||
    seedSecret === undefined ||
    expectedProjectRef === undefined ||
    actualProjectRef !== expectedProjectRef ||
    actualProjectRef === process.env.SUPABASE_PRODUCTION_PROJECT_REF
  ) {
    throw new Error("E2E seed configuration is not safely isolated");
  }
  return { serviceRoleKey, seedSecret, url };
};

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

  const admin = createClient<Database>(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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
  ]);
  const document = await admin
    .from("documents")
    .insert({
      author_id: owner.data.user.id,
      slug: `shared-notes-${suffix}`,
      title: "Shared notes",
      workspace_id: workspace.data.id,
    })
    .select("id, slug, title")
    .single();
  if (membership.error !== null || document.error !== null) {
    await Promise.all([
      admin.auth.admin.deleteUser(owner.data.user.id),
      admin.auth.admin.deleteUser(editor.data.user.id),
      admin.auth.admin.deleteUser(viewer.data.user.id),
    ]);
    return NextResponse.json(
      { error: "Workspace data seed failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    document: document.data,
    editor: { email: emails.editor, password },
    owner: { email: emails.owner, password },
    viewer: { email: emails.viewer, password },
    workspace: workspace.data,
  });
}
