/*
  Warnings:

  - You are about to drop the `Document` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DocumentVersion` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Workspace` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WorkspaceMember` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_author_id_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "DocumentVersion" DROP CONSTRAINT "DocumentVersion_doc_id_fkey";

-- DropForeignKey
ALTER TABLE "Workspace" DROP CONSTRAINT "Workspace_owner_id_fkey";

-- DropForeignKey
ALTER TABLE "WorkspaceMember" DROP CONSTRAINT "WorkspaceMember_user_id_fkey";

-- DropForeignKey
ALTER TABLE "WorkspaceMember" DROP CONSTRAINT "WorkspaceMember_workspace_id_fkey";

-- DropTable
DROP TABLE "Document";

-- DropTable
DROP TABLE "DocumentVersion";

-- DropTable
DROP TABLE "User";

-- DropTable
DROP TABLE "Workspace";

-- DropTable
DROP TABLE "WorkspaceMember";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "full_name" TEXT DEFAULT '',
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" TEXT DEFAULT 'system',
    "updated_by" TEXT DEFAULT 'system',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" TEXT DEFAULT 'system',
    "updated_by" TEXT DEFAULT 'system',

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'EDITOR',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" TEXT DEFAULT 'system',
    "updated_by" TEXT DEFAULT 'system',
    "invited_by" TEXT,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "author_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "markdown_content" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" TEXT DEFAULT 'system',
    "updated_by" TEXT DEFAULT 'system',
    "is_public" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "workspaces_owner_id_idx" ON "workspaces"("owner_id");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

-- CreateIndex
CREATE INDEX "workspace_members_workspace_id_idx" ON "workspace_members"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_user_id_workspace_id_key" ON "workspace_members"("user_id", "workspace_id");

-- CreateIndex
CREATE INDEX "documents_workspace_id_idx" ON "documents"("workspace_id");

-- CreateIndex
CREATE INDEX "documents_author_id_idx" ON "documents"("author_id");

-- CreateIndex
CREATE INDEX "document_versions_doc_id_idx" ON "document_versions"("doc_id");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
