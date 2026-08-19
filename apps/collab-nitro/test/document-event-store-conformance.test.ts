import { documentEventStoreConformance } from "@softmaple/collab-runtime/testing";
import { beforeEach, describe, it, vi } from "vitest";
import { createPrismaEventStoreMock } from "./helpers/prismaEventStoreMock";

const mocks = createPrismaEventStoreMock();

vi.doMock("../server/utils/prisma", () => ({
  prisma: mocks.prisma,
}));

const { prismaDocumentEventStore } = await import(
  "../server/adapters/prisma-document-event-store"
);

describe("document event store (Nitro/Prisma adapter)", () => {
  beforeEach(() => {
    mocks.reset();
  });

  for (const testCase of documentEventStoreConformance(
    () => prismaDocumentEventStore,
  )) {
    it(testCase.name, testCase.run);
  }
});
