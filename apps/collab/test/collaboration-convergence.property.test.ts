import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createCollabConsistencyHarness,
  type HarnessClient,
} from "./helpers/collabConsistencyHarness";

const ACTORS = [
  "00000000-0000-4000-8000-0000000000c1",
  "00000000-0000-4000-8000-0000000000c2",
  "00000000-0000-4000-8000-0000000000c3",
] as const;

const CI_NUM_RUNS = Number(process.env.COLLAB_CONVERGENCE_RUNS ?? 40);
const SOAK_NUM_RUNS = Number(process.env.COLLAB_CONVERGENCE_SOAK_RUNS ?? 200);
const isSoak = process.env.COLLAB_CONVERGENCE_SOAK === "1";

type TraceOp =
  | { readonly kind: "edit"; readonly client: number; readonly text: string }
  | { readonly kind: "disconnect"; readonly client: number }
  | { readonly kind: "reconnect"; readonly client: number }
  | { readonly kind: "deliver" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "reorder" }
  | { readonly kind: "settle" };

type Trace = {
  readonly clientCount: 2 | 3;
  readonly ops: ReadonlyArray<TraceOp>;
};

const textArb = fc.constantFrom("a", "b", "c", "x", "y", "z");

const opArb = (clientCount: 2 | 3): fc.Arbitrary<TraceOp> =>
  fc.oneof(
    {
      arbitrary: fc.record({
        kind: fc.constant("edit" as const),
        client: fc.integer({ min: 0, max: clientCount - 1 }),
        text: textArb,
      }),
      weight: 5,
    },
    {
      arbitrary: fc.record({
        kind: fc.constant("disconnect" as const),
        client: fc.integer({ min: 0, max: clientCount - 1 }),
      }),
      weight: 1,
    },
    {
      arbitrary: fc.record({
        kind: fc.constant("reconnect" as const),
        client: fc.integer({ min: 0, max: clientCount - 1 }),
      }),
      weight: 1,
    },
    { arbitrary: fc.constant({ kind: "deliver" as const }), weight: 3 },
    { arbitrary: fc.constant({ kind: "duplicate" as const }), weight: 1 },
    { arbitrary: fc.constant({ kind: "reorder" as const }), weight: 1 },
    { arbitrary: fc.constant({ kind: "settle" as const }), weight: 2 },
  );

const traceArb: fc.Arbitrary<Trace> = fc
  .constantFrom(2, 3)
  .chain((clientCount) =>
    fc.record({
      clientCount: fc.constant(clientCount as 2 | 3),
      ops: fc.array(opArb(clientCount as 2 | 3), {
        minLength: 4,
        maxLength: isSoak ? 40 : 18,
      }),
    }),
  );

const formatTrace = (trace: Trace): string =>
  JSON.stringify(
    {
      clientCount: trace.clientCount,
      ops: trace.ops,
    },
    null,
    2,
  );

const runTrace = async (trace: Trace): Promise<void> => {
  const harness = createCollabConsistencyHarness({ pageSize: 2 });
  harness.setDeliveryMode("deferred");
  try {
    const instanceA = harness.createInstance("A");
    const instanceB = harness.createInstance("B");
    const clients: HarnessClient[] = [];

    for (let index = 0; index < trace.clientCount; index += 1) {
      const instance = index % 2 === 0 ? instanceA : instanceB;
      const client = await instance.connectClient({
        id: `client-${index}`,
        actorId: ACTORS[index]!,
      });
      clients.push(client);
    }

    await harness.settle();
    for (const client of clients) {
      await client.waitUntilSynced();
    }

    for (const [opIndex, op] of trace.ops.entries()) {
      try {
        switch (op.kind) {
          case "edit": {
            const client = clients[op.client]!;
            if (!client.isConnected()) break;
            // Insert at start so concurrent branches remain valid.
            client.localInsert(op.text, 0);
            break;
          }
          case "disconnect": {
            const client = clients[op.client]!;
            if (client.isConnected()) await client.disconnect();
            break;
          }
          case "reconnect": {
            const client = clients[op.client]!;
            if (!client.isConnected()) await client.connect();
            break;
          }
          case "deliver":
            await harness.deliverNext();
            break;
          case "duplicate":
            harness.duplicateNextDelivery();
            break;
          case "reorder":
            harness.reorderNextDeliveryPair();
            break;
          case "settle":
            await harness.settle();
            break;
        }
        await harness.pumpProtocol(32);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Trace failed at op ${opIndex} (${JSON.stringify(op)}): ${message}\n${formatTrace(trace)}`,
        );
      }
    }

    // Reconnect anyone left offline and drain the pipeline.
    for (const client of clients) {
      if (!client.isConnected()) await client.connect();
    }
    await harness.settle();
    for (const client of clients) {
      await client.waitUntilIdle();
    }

    for (const client of clients) {
      expect(client.conflicts(), formatTrace(trace)).toEqual([]);
    }

    const durableIds = new Set(harness.store.listBatchIds(harness.documentId));
    for (const client of clients) {
      for (const batchId of client.acknowledgedBatchIds()) {
        expect(durableIds.has(batchId), formatTrace(trace)).toBe(true);
      }
      expect(client.pendingBatchIds(), formatTrace(trace)).toEqual([]);
    }

    harness.assertReplicasConverged(clients);
  } finally {
    await harness.close();
  }
};

describe("randomized collaboration convergence", () => {
  it("should converge for seeded multi-client collaboration traces", async () => {
    await fc.assert(
      fc.asyncProperty(traceArb, async (trace) => {
        await runTrace(trace);
      }),
      {
        numRuns: isSoak ? SOAK_NUM_RUNS : CI_NUM_RUNS,
        // Fixed seed keeps CI deterministic; override with fc seed on failure.
        seed: 868_001,
        verbose: true,
        endOnFailure: true,
      },
    );
  });

  it("should reproduce a known reconnect-and-duplicate interleaving", async () => {
    // Arrange / Act / Assert: explicit regression seed path for debugging.
    const trace: Trace = {
      clientCount: 2,
      ops: [
        { kind: "edit", client: 0, text: "a" },
        { kind: "edit", client: 1, text: "b" },
        { kind: "disconnect", client: 1 },
        { kind: "edit", client: 0, text: "c" },
        { kind: "deliver" },
        { kind: "duplicate" },
        { kind: "reconnect", client: 1 },
        { kind: "settle" },
        { kind: "edit", client: 1, text: "d" },
        { kind: "reorder" },
        { kind: "settle" },
      ],
    };
    await runTrace(trace);
  });
});
