import { describe, expect, it } from "vitest";
import {
  type BroadcastChannelFactory,
  type BroadcastChannelLike,
  createPersistenceChannel,
  getPersistenceChannelName,
  PERSISTENCE_CHANNEL_MESSAGE_TYPE,
  PERSISTENCE_CHANNEL_PROTOCOL_VERSION,
} from "./channel";
import { type WireBatch, WireBatchSchema } from "./schema";

class MockBroadcastNetwork {
  private readonly channels = new Map<string, Set<MockBroadcastChannel>>();

  readonly createChannel: BroadcastChannelFactory = (name) => {
    const channel = new MockBroadcastChannel(name, this);
    const peers = this.channels.get(name) ?? new Set<MockBroadcastChannel>();
    peers.add(channel);
    this.channels.set(name, peers);
    return channel;
  };

  deliver(sender: MockBroadcastChannel, message: unknown): void {
    for (const peer of this.channels.get(sender.name) ?? []) {
      if (peer === sender) continue;
      peer.onmessage?.({ data: structuredClone(message) });
    }
  }

  remove(channel: MockBroadcastChannel): void {
    this.channels.get(channel.name)?.delete(channel);
  }
}

class MockBroadcastChannel implements BroadcastChannelLike {
  onmessage: BroadcastChannelLike["onmessage"] = null;

  constructor(
    readonly name: string,
    private readonly network: MockBroadcastNetwork,
  ) {}

  postMessage(message: unknown): void {
    this.network.deliver(this, message);
  }

  close(): void {
    this.network.remove(this);
  }
}

const createBatch = (batchId: string, text: string): WireBatch =>
  WireBatchSchema.parse({
    schemaVersion: 1,
    batchId,
    parentVersion: [],
    events: [
      {
        schemaVersion: 1,
        id: `${batchId}:event`,
        parentVersion: [],
        operation: { type: "insert", text },
      },
    ],
  });

describe("persistence BroadcastChannel protocol", () => {
  it("delivers events once and repairs a late joiner", () => {
    const network = new MockBroadcastNetwork();
    const a = createPersistenceChannel({
      roomId: "room-a",
      peerId: "a",
      channelFactory: network.createChannel,
      createId: () => "repair-a",
    });
    const b = createPersistenceChannel({
      roomId: "room-a",
      peerId: "b",
      channelFactory: network.createChannel,
    });
    const delivered: string[] = [];
    b.subscribeBatches((batch) => delivered.push(batch.batchId));

    const first = createBatch("batch-1", "hello");
    expect(a.publishBatch(first)).toBe(true);
    expect(a.publishBatch(first)).toBe(false);
    expect(delivered).toEqual(["batch-1"]);

    const late = createPersistenceChannel({
      roomId: "room-a",
      peerId: "late",
      channelFactory: network.createChannel,
      createId: () => "late-repair",
    });
    late.requestRepair();
    expect([...late.getKnownBatchIds()]).toEqual(["batch-1"]);

    a.close();
    b.close();
    late.close();
  });

  it("deduplicates durable acknowledgements", () => {
    const network = new MockBroadcastNetwork();
    const a = createPersistenceChannel({
      roomId: "room-a",
      peerId: "a",
      channelFactory: network.createChannel,
    });
    const b = createPersistenceChannel({
      roomId: "room-a",
      peerId: "b",
      channelFactory: network.createChannel,
    });
    const acknowledgements: string[][] = [];
    b.subscribeDurableAcks((batchIds) => acknowledgements.push([...batchIds]));

    a.broadcastDurableAck(["batch-1", "batch-1"]);
    a.broadcastDurableAck(["batch-1"]);

    expect(acknowledgements).toEqual([["batch-1"]]);
    expect([...b.getDurableBatchIds()]).toEqual(["batch-1"]);
  });

  it("rejects malformed messages and conflicting duplicate batches", () => {
    const network = new MockBroadcastNetwork();
    const raw = network.createChannel(getPersistenceChannelName("room-a"));
    const receiver = createPersistenceChannel({
      roomId: "room-a",
      peerId: "receiver",
      channelFactory: network.createChannel,
    });
    const errors: string[] = [];
    receiver.subscribeErrors((error) => errors.push(error.message));

    raw.postMessage({
      protocolVersion: PERSISTENCE_CHANNEL_PROTOCOL_VERSION,
      type: PERSISTENCE_CHANNEL_MESSAGE_TYPE.Event,
      roomId: "room-a",
      senderId: "raw",
      batch: {
        schemaVersion: 1,
        batchId: "invalid",
        parentVersion: [],
        events: [{ schemaVersion: 1, id: "event", parentVersion: {} }],
      },
    });

    const original = createBatch("same-id", "left");
    const conflict = createBatch("same-id", "right");
    receiver.seedBatches([original]);
    const sender = createPersistenceChannel({
      roomId: "room-a",
      peerId: "sender",
      channelFactory: network.createChannel,
    });
    sender.publishBatch(conflict);

    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/Invalid persistence channel message/);
    expect(errors[1]).toMatch(/Conflicting payloads/);
    expect(receiver.getKnownBatches()).toEqual([original]);
  });

  it("validates domain batches before accepting channel messages", () => {
    const network = new MockBroadcastNetwork();
    const receiver = createPersistenceChannel({
      roomId: "room-a",
      peerId: "receiver",
      channelFactory: network.createChannel,
      parseBatch: (input) => {
        const parsed = WireBatchSchema.parse(input);
        const [firstEvent] = parsed.events;
        if (firstEvent === undefined || !("effect" in firstEvent)) {
          throw new Error("Rich-text effect is required");
        }
        return parsed;
      },
    });
    const sender = createPersistenceChannel({
      roomId: "room-a",
      peerId: "sender",
      channelFactory: network.createChannel,
    });
    const delivered: string[] = [];
    const errors: string[] = [];
    receiver.subscribeBatches((batch) => delivered.push(batch.batchId));
    receiver.subscribeErrors((error) => errors.push(error.message));

    sender.publishBatch(createBatch("structural-only", "hello"));

    expect(delivered).toEqual([]);
    expect(receiver.getKnownBatches()).toEqual([]);
    expect(errors).toEqual([
      "Invalid persistence batch: Rich-text effect is required",
    ]);
  });

  it("isolates rooms through channel names", () => {
    const network = new MockBroadcastNetwork();
    const a = createPersistenceChannel({
      roomId: "room-a",
      peerId: "a",
      channelFactory: network.createChannel,
    });
    const b = createPersistenceChannel({
      roomId: "room-b",
      peerId: "b",
      channelFactory: network.createChannel,
    });

    a.publishBatch(createBatch("batch-1", "hello"));
    expect(b.getKnownBatches()).toEqual([]);
  });
});
