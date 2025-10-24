/*
  Warnings:

  - A unique constraint covering the columns `[slug]` on the table `documents` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `slug` to the `documents` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "slug" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "documents_slug_key" ON "documents"("slug");
