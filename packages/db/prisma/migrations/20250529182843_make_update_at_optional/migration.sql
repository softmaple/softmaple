-- AlterTable
ALTER TABLE "document_versions" ALTER COLUMN "updated_at" DROP NOT NULL;

-- AlterTable
ALTER TABLE "documents" ALTER COLUMN "updated_at" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "updated_at" DROP NOT NULL;

-- AlterTable
ALTER TABLE "workspace_members" ALTER COLUMN "updated_at" DROP NOT NULL;

-- AlterTable
ALTER TABLE "workspaces" ALTER COLUMN "updated_at" DROP NOT NULL;
