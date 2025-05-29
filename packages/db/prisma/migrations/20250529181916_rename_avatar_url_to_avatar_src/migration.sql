/*
  Warnings:

  - You are about to drop the column `avatar_url` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `avatar_url` on the `workspaces` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "avatar_url",
ADD COLUMN     "avatar_src" TEXT;

-- AlterTable
ALTER TABLE "workspaces" DROP COLUMN "avatar_url",
ADD COLUMN     "avatar_src" TEXT;
