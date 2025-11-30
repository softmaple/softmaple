// Prisma v7 configuration file
// https://pris.ly/d/config-datasource

import { defineConfig } from "@prisma/config";

export default defineConfig({
  datasource: {
    provider: "postgresql",
    url: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
  },
});
