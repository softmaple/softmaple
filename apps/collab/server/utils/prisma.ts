import { createPrismaClient, type PrismaClient } from "@softmaple/db";

let client: PrismaClient | null = null;

export const getPrisma = (): PrismaClient => {
  if (!client) client = createPrismaClient();
  return client;
};

export const setPrismaForTests = (next: PrismaClient | null): void => {
  client = next;
};
