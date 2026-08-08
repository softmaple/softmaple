import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Supabase: Prisma CLI (migrate/db execute) requires direct TCP.
    // Do not fall back to DATABASE_URL (pooled) — migrations need DIRECT_URL.
    // Empty string keeps `prisma generate` working when no DB URL is set;
    // migrate/db execute fail at connection time if DIRECT_URL is missing.
    // Runtime PrismaClient uses DATABASE_URL via the adapter in src/client.ts.
    url: process.env.DIRECT_URL ?? "",
  },
});
