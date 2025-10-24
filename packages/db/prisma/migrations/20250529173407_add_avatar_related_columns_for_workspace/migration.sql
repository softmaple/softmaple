-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_alt" TEXT DEFAULT '';

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "avatar_alt" TEXT DEFAULT '',
ADD COLUMN     "avatar_url" TEXT;
