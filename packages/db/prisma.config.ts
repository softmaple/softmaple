// Prisma v7 configuration file
// https://pris.ly/d/config-datasource

import "dotenv/config";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  // the main entry for your schema
  schema: path.join("prisma", "schema.prisma"),
  // where migrations should be generated
  // what script to run for "prisma db seed"
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // The database URL
  datasource: {
    // Type Safe env() helper
    // Does not replace the need for dotenv
    url: env("DATABASE_URL"),
    shadowDatabaseUrl: env("DIRECT_URL"),
  },
});
