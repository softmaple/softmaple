import { z } from "zod";

export const PERSISTENCE_SCHEMA_VERSION = 1 as const;
export const PERSISTENCE_ROW_KIND = {
  Event: "event",
  Room: "room",
} as const;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | ReadonlyArray<JsonValue>;

/** Minimal structural view of a block-model event at the persistence boundary. */
export interface WireGraphEvent {
  readonly schemaVersion: typeof PERSISTENCE_SCHEMA_VERSION;
  readonly id: string;
  readonly parentVersion: ReadonlyArray<string>;
}

/**
 * Readonly arrays intentionally match `RichTextEventBatch` without importing
 * the block model into this generic storage layer.
 */
export interface WireBatch {
  readonly schemaVersion: typeof PERSISTENCE_SCHEMA_VERSION;
  readonly batchId: string;
  readonly parentVersion: ReadonlyArray<string>;
  readonly events: ReadonlyArray<WireGraphEvent>;
}

export type WireBatchParser = (input: unknown) => WireBatch;

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const NonEmptyIdSchema = z.string().min(1);
const ParentVersionSchema = z
  .array(NonEmptyIdSchema)
  .refine((parents) => new Set(parents).size === parents.length, {
    message: "parentVersion must not contain duplicate event IDs",
  });

/**
 * JSON-safe event envelope shared by storage and BroadcastChannel messages.
 * Event-specific fields such as `operation` and `timestamp` remain generic so
 * the persistence layer does not depend on the block model package.
 */
export const WireGraphEventSchema: z.ZodType<WireGraphEvent> = z
  .object({
    schemaVersion: z.literal(PERSISTENCE_SCHEMA_VERSION),
    id: NonEmptyIdSchema,
    parentVersion: ParentVersionSchema,
  })
  .catchall(JsonValueSchema);

export const WireBatchSchema: z.ZodType<WireBatch> = z
  .object({
    schemaVersion: z.literal(PERSISTENCE_SCHEMA_VERSION),
    batchId: NonEmptyIdSchema,
    parentVersion: ParentVersionSchema,
    events: z.array(WireGraphEventSchema).min(1),
  })
  .strict()
  .superRefine((batch, context) => {
    const eventIds = batch.events.map((event) => event.id);
    if (new Set(eventIds).size !== eventIds.length) {
      context.addIssue({
        code: "custom",
        message: "batch events must have unique IDs",
        path: ["events"],
      });
    }
  });

export const parseWireBatch: WireBatchParser = (input) =>
  WireBatchSchema.parse(input);

export const RoomRowSchema = z
  .object({
    key: NonEmptyIdSchema,
    kind: z.literal(PERSISTENCE_ROW_KIND.Room),
    schemaVersion: z.literal(PERSISTENCE_SCHEMA_VERSION),
    roomId: NonEmptyIdSchema,
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export const EventRowSchema = z
  .object({
    key: NonEmptyIdSchema,
    kind: z.literal(PERSISTENCE_ROW_KIND.Event),
    schemaVersion: z.literal(PERSISTENCE_SCHEMA_VERSION),
    roomId: NonEmptyIdSchema,
    createdAt: z.number().int().nonnegative(),
    batch: WireBatchSchema,
  })
  .strict();

export const PersistenceRowSchema = z.discriminatedUnion("kind", [
  RoomRowSchema,
  EventRowSchema,
]);

const StoredItemSchema = z
  .object({
    versionKey: NonEmptyIdSchema,
    data: PersistenceRowSchema,
  })
  .strict();

/** The current on-disk envelope used by TanStack DB's localStorage adapter. */
export const PersistenceStorageEnvelopeSchema = z.record(
  z.string(),
  StoredItemSchema,
);

export type RoomRow = z.infer<typeof RoomRowSchema>;
export type EventRow = z.infer<typeof EventRowSchema>;
export type PersistenceRow = z.infer<typeof PersistenceRowSchema>;

export class CorruptPersistenceStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorruptPersistenceStorageError";
  }
}

export const getRoomRowKey = (roomId: string): string => `room:${roomId}`;
export const getEventRowKey = (batchId: string): string => `event:${batchId}`;

export const createRoomRow = (
  roomId: string,
  createdAt: number = Date.now(),
): RoomRow =>
  RoomRowSchema.parse({
    key: getRoomRowKey(roomId),
    kind: PERSISTENCE_ROW_KIND.Room,
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
    roomId,
    createdAt,
  });

export const createEventRow = (
  roomId: string,
  batch: WireBatch,
  createdAt: number = Date.now(),
): EventRow =>
  EventRowSchema.parse({
    key: getEventRowKey(batch.batchId),
    kind: PERSISTENCE_ROW_KIND.Event,
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
    roomId,
    createdAt,
    batch,
  });

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new CorruptPersistenceStorageError(
      "Persistence storage contains invalid JSON",
    );
  }
};

/**
 * Validate raw localStorage before TanStack DB loads it. The adapter otherwise
 * treats malformed data as an empty collection, which could overwrite the only
 * recoverable copy on the next write.
 */
export const parsePersistenceStorage = (
  raw: string | null,
  expectedRoomId: string,
  parseBatch: WireBatchParser = parseWireBatch,
): ReadonlyArray<PersistenceRow> => {
  if (raw === null) return [];

  const parsed = PersistenceStorageEnvelopeSchema.safeParse(parseJson(raw));
  if (!parsed.success) {
    throw new CorruptPersistenceStorageError(
      `Persistence storage has an invalid envelope: ${z.prettifyError(parsed.error)}`,
    );
  }

  const rows: PersistenceRow[] = Object.entries(parsed.data).map(
    ([encodedKey, storedItem]) => {
      const { data } = storedItem;
      if (data.roomId !== expectedRoomId) {
        throw new CorruptPersistenceStorageError(
          `Persistence row belongs to room ${data.roomId}, expected ${expectedRoomId}`,
        );
      }

      const expectedEncodedKey = `s:${data.key}`;
      if (encodedKey !== expectedEncodedKey) {
        throw new CorruptPersistenceStorageError(
          `Persistence row key ${encodedKey} does not match ${expectedEncodedKey}`,
        );
      }
      if (data.kind === PERSISTENCE_ROW_KIND.Room) return data;

      let batch: WireBatch;
      try {
        batch = parseBatch(data.batch);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown validation error";
        throw new CorruptPersistenceStorageError(
          `Persistence event batch ${data.batch.batchId} is invalid: ${message}`,
        );
      }

      if (data.key !== getEventRowKey(batch.batchId)) {
        throw new CorruptPersistenceStorageError(
          `Persistence event row key ${data.key} does not match its batch ID`,
        );
      }
      return { ...data, batch };
    },
  );

  const roomRows = rows.filter(
    (row): row is RoomRow => row.kind === PERSISTENCE_ROW_KIND.Room,
  );
  if (roomRows.length > 1) {
    throw new CorruptPersistenceStorageError(
      "Persistence storage contains more than one room row",
    );
  }
  if (roomRows[0] && roomRows[0].key !== getRoomRowKey(expectedRoomId)) {
    throw new CorruptPersistenceStorageError(
      "Persistence room row has an invalid key",
    );
  }

  const eventBatchIds = rows.flatMap((row) =>
    row.kind === PERSISTENCE_ROW_KIND.Event ? [row.batch.batchId] : [],
  );
  if (new Set(eventBatchIds).size !== eventBatchIds.length) {
    throw new CorruptPersistenceStorageError(
      "Persistence storage contains duplicate event batch IDs",
    );
  }

  return rows;
};
