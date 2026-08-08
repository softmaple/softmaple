import { z } from "zod";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | ReadonlyArray<JsonValue>;

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

/** Structural wire view of a rich-text event (operation fields remain open). */
export interface WireGraphEvent {
  readonly schemaVersion: number;
  readonly id: string;
  readonly parentVersion: ReadonlyArray<string>;
}

export interface WireBatch {
  readonly schemaVersion: number;
  readonly batchId: string;
  readonly parentVersion: ReadonlyArray<string>;
  readonly events: ReadonlyArray<WireGraphEvent>;
}

export type WireBatchParser = (input: unknown) => WireBatch;

export const BOOTSTRAP_BATCH_ID = "softmaple:block-model:bootstrap:v1";
export const BOOTSTRAP_EVENT_ID = "softmaple:block-model:bootstrap:event:v1";

export const WireGraphEventSchema: z.ZodType<WireGraphEvent> = z
  .object({
    schemaVersion: z.number().int().positive(),
    id: NonEmptyIdSchema,
    parentVersion: ParentVersionSchema,
  })
  .catchall(JsonValueSchema);

export const WireBatchSchema: z.ZodType<WireBatch> = z
  .object({
    schemaVersion: z.number().int().positive(),
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
    const first = batch.events[0];
    if (!first) return;

    const isCanonicalBootstrap =
      batch.batchId === BOOTSTRAP_BATCH_ID &&
      first.id === BOOTSTRAP_EVENT_ID &&
      batch.parentVersion.length === 0 &&
      first.parentVersion.length === 0;

    if (batch.batchId !== first.id && !isCanonicalBootstrap) {
      context.addIssue({
        code: "custom",
        message: "batchId must equal the first event ID",
        path: ["batchId"],
      });
    }
    if (batch.batchId === BOOTSTRAP_BATCH_ID && !isCanonicalBootstrap) {
      context.addIssue({
        code: "custom",
        message:
          "bootstrap batchId requires bootstrap event ID and empty parentVersion",
        path: ["batchId"],
      });
    }
    if (
      JSON.stringify(batch.parentVersion) !==
      JSON.stringify(first.parentVersion)
    ) {
      context.addIssue({
        code: "custom",
        message: "Batch parentVersion must equal its first event parents",
        path: ["parentVersion"],
      });
    }
    for (let index = 1; index < batch.events.length; index++) {
      const event = batch.events[index]!;
      const previous = batch.events[index - 1]!;
      if (
        event.parentVersion.length !== 1 ||
        event.parentVersion[0] !== previous.id
      ) {
        context.addIssue({
          code: "custom",
          message: "Rich-text batch events must form a strict causal chain",
          path: ["events", index, "parentVersion"],
        });
      }
    }
  });

export const parseWireBatch: WireBatchParser = (input) =>
  WireBatchSchema.parse(input);
