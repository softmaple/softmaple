/*
  Warnings:

  - Added the required column `workspace_id` to the `document_versions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "document_versions" ADD COLUMN     "workspace_id" INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
