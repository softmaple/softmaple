import { describe, expect, it } from "vitest";
import {
  CorruptPersistenceStorageError,
  createEventRow,
  createRoomRow,
  EventRowSchema,
  parsePersistenceStorage,
  WireBatchSchema,
} from "./schema";

const ROOM_ID = "room-a";

const batch = WireBatchSchema.parse({
  schemaVersion: 1,
  batchId: "batch-1",
  parentVersion: ["bootstrap:0"],
  events: [
    {
      schemaVersion: 1,
      id: "alice:1",
      parentVersion: ["bootstrap:0"],
      operation: { type: "insert", text: "hello" },
      timestamp: 1,
    },
  ],
});

const encodeRows = (
  rows: ReadonlyArray<ReturnType<typeof createRoomRow | typeof createEventRow>>,
): string =>
  JSON.stringify(
    Object.fromEntries(
      rows.map((row, index) => [
        `s:${row.key}`,
        { versionKey: `version-${index}`, data: row },
      ]),
    ),
  );

describe("lexical EG-walker persistence schema", () => {
  it("round-trips versioned room and event rows through JSON", () => {
    const rows = [createRoomRow(ROOM_ID, 1), createEventRow(ROOM_ID, batch, 2)];

    expect(parsePersistenceStorage(encodeRows(rows), ROOM_ID)).toEqual(rows);
    expect(rows[1]?.kind).toBe("event");
    if (rows[1]?.kind === "event") {
      expect(rows[1].batch.events[0]?.parentVersion).toEqual(["bootstrap:0"]);
    }
  });

  it("accepts the readonly array shape exported by the block model", () => {
    const readonlyBatch = {
      schemaVersion: 1,
      batchId: "readonly-batch",
      parentVersion: ["root:0"],
      events: [
        {
          schemaVersion: 1,
          id: "readonly:1",
          parentVersion: ["root:0"],
          operation: { type: "insert", text: "ok" },
        },
      ],
    } as const;

    expect(WireBatchSchema.parse(readonlyBatch)).toEqual(readonlyBatch);
  });

  it("accepts an empty storage key as a new room", () => {
    expect(parsePersistenceStorage(null, ROOM_ID)).toEqual([]);
  });

  it("runs domain validation before returning stored event batches", () => {
    const rows = [createRoomRow(ROOM_ID, 1), createEventRow(ROOM_ID, batch, 2)];

    expect(() =>
      parsePersistenceStorage(encodeRows(rows), ROOM_ID, () => {
        throw new Error("Invalid rich-text event");
      }),
    ).toThrow(/batch batch-1 is invalid: Invalid rich-text event/);
  });

  it("rejects Set parent versions and duplicate event IDs", () => {
    expect(() =>
      WireBatchSchema.parse({
        schemaVersion: 1,
        batchId: "set-parents",
        parentVersion: new Set(["root:0"]),
        events: [{ schemaVersion: 1, id: "a:1", parentVersion: [] }],
      }),
    ).toThrow();

    expect(() =>
      WireBatchSchema.parse({
        schemaVersion: 1,
        batchId: "duplicate-events",
        parentVersion: [],
        events: [
          { schemaVersion: 1, id: "a:1", parentVersion: [] },
          { schemaVersion: 1, id: "a:1", parentVersion: [] },
        ],
      }),
    ).toThrow(/unique IDs/);

    expect(() =>
      WireBatchSchema.parse({
        schemaVersion: 1,
        batchId: "duplicate-parents",
        parentVersion: ["root:0", "root:0"],
        events: [{ schemaVersion: 1, id: "a:1", parentVersion: ["root:0"] }],
      }),
    ).toThrow(/must not contain duplicate/);
  });

  it("rejects a wrong schema version", () => {
    expect(() =>
      EventRowSchema.parse({
        ...createEventRow(ROOM_ID, batch, 2),
        schemaVersion: 2,
      }),
    ).toThrow();
  });

  it("reports malformed JSON, wrong rooms, and mismatched envelope keys", () => {
    expect(() => parsePersistenceStorage("{", ROOM_ID)).toThrow(
      CorruptPersistenceStorageError,
    );

    const otherRoomRow = createRoomRow("room-b", 1);
    expect(() =>
      parsePersistenceStorage(encodeRows([otherRoomRow]), ROOM_ID),
    ).toThrow(/belongs to room/);

    const roomRow = createRoomRow(ROOM_ID, 1);
    const mismatchedKey = JSON.stringify({
      "s:not-the-row-key": { versionKey: "v1", data: roomRow },
    });
    expect(() => parsePersistenceStorage(mismatchedKey, ROOM_ID)).toThrow(
      /does not match/,
    );
  });

  it("rejects duplicate event batches, multiple room rows, and mismatched event keys", () => {
    const eventRow = createEventRow(ROOM_ID, batch, 2);
    const duplicateEventRow = {
      ...createEventRow(ROOM_ID, batch, 3),
      key: "event:duplicate-batch-1",
    };
    expect(() =>
      parsePersistenceStorage(
        encodeRows([eventRow, duplicateEventRow]),
        ROOM_ID,
      ),
    ).toThrow(CorruptPersistenceStorageError);

    const duplicateRoomRow = {
      ...createRoomRow(ROOM_ID, 2),
      key: "room:duplicate-room-a",
    };
    expect(() =>
      parsePersistenceStorage(
        encodeRows([createRoomRow(ROOM_ID, 1), duplicateRoomRow]),
        ROOM_ID,
      ),
    ).toThrow(/more than one room row/);

    const mismatchedEventRow = {
      ...eventRow,
      key: "event:not-batch-1",
    };
    expect(() =>
      parsePersistenceStorage(encodeRows([mismatchedEventRow]), ROOM_ID),
    ).toThrow(/does not match its batch ID/);
  });
});
