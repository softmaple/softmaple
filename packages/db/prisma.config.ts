import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Supabase: Prisma CLI (migrate/db execute) needs the direct TCP URL.
    // Runtime PrismaClient should use DATABASE_URL (pooled) via the adapter.
    // Fall back so `prisma generate` can run without a live database URL.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
