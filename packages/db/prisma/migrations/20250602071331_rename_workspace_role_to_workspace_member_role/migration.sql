/*
  Warnings:

  - The `role` column on the `workspace_members` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "WorkspaceMemberRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- AlterTable
ALTER TABLE "workspace_members" DROP COLUMN "role",
ADD COLUMN     "role" "WorkspaceMemberRole" NOT NULL DEFAULT 'EDITOR';

-- DropEnum
DROP TYPE "WorkspaceRole";
