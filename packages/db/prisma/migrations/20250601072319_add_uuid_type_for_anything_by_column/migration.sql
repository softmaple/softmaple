/*
  Warnings:

  - The `created_by` column on the `documents` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `updated_by` column on the `documents` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `created_by` column on the `users` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `updated_by` column on the `users` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `created_by` column on the `workspace_members` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `updated_by` column on the `workspace_members` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `invited_by` column on the `workspace_members` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `created_by` column on the `workspaces` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `updated_by` column on the `workspaces` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "document_versions" ADD COLUMN     "created_by" UUID,
ADD COLUMN     "updated_by" UUID;

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "created_by",
ADD COLUMN     "created_by" UUID,
DROP COLUMN "updated_by",
ADD COLUMN     "updated_by" UUID;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "created_by",
ADD COLUMN     "created_by" UUID,
DROP COLUMN "updated_by",
ADD COLUMN     "updated_by" UUID;

-- AlterTable
ALTER TABLE "workspace_members" DROP COLUMN "created_by",
ADD COLUMN     "created_by" UUID,
DROP COLUMN "updated_by",
ADD COLUMN     "updated_by" UUID,
DROP COLUMN "invited_by",
ADD COLUMN     "invited_by" UUID;

-- AlterTable
ALTER TABLE "workspaces" DROP COLUMN "created_by",
ADD COLUMN     "created_by" UUID,
DROP COLUMN "updated_by",
ADD COLUMN     "updated_by" UUID;
