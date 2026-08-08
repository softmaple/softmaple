import { createPrismaClient, type PrismaClient } from "@softmaple/db";

const globalWithPrisma = globalThis as typeof globalThis & {
  softmapleCollabPrisma?: PrismaClient;
};

export const prisma =
  globalWithPrisma.softmapleCollabPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalWithPrisma.softmapleCollabPrisma = prisma;
}
