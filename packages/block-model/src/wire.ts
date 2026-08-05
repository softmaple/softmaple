import type { GraphEvent } from "@softmaple/eg-walker";
import {
  isSequenceAnchor,
  type SequenceAnchor,
} from "@softmaple/eg-walker/anchors";

import {
  BLOCK_MARKER,
  BLOCK_MODEL_SCHEMA_VERSION,
  BOOTSTRAP_BATCH_ID,
  BOOTSTRAP_BLOCK_ID,
  BOOTSTRAP_EVENT_ID,
  BOOTSTRAP_TIMESTAMP,
  METADATA_MARKER,
  TEXT_ESCAPE,
} from "./constants";
import type {
  BlockAttributePatch,
  BlockFieldPatch,
  BlockType,
  CompleteBlockFields,
  LinkAttributes,
  MarkKind,
  RichTextEffect,
  RichTextEvent,
  RichTextEventBatch,
  SerializedTextOperation,
} from "./types";

const BLOCK_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "h1",
  "h2",
  "h3",
  "quote",
  "code",
  "bullet-list",
  "number-list",
  "check-list",
]);

const MARK_KINDS: ReadonlySet<string> = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "inline-code",
  "link",
]);

export const DEFAULT_BLOCK_FIELDS: CompleteBlockFields = Object.freeze({
  type: "paragraph",
  parentId: null,
  language: null,
  theme: null,
  start: null,
  value: null,
  checked: null,
});

export const BOOTSTRAP_BATCH: RichTextEventBatch = deepFreezeBatch({
  schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
  batchId: BOOTSTRAP_BATCH_ID,
  parentVersion: [],
  events: [
    {
      schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
      id: BOOTSTRAP_EVENT_ID,
      parentVersion: [],
      timestamp: BOOTSTRAP_TIMESTAMP,
      operation: { type: "insert", index: 0, text: BLOCK_MARKER },
      effect: {
        type: "bootstrap",
        blockId: BOOTSTRAP_BLOCK_ID,
        fields: DEFAULT_BLOCK_FIELDS,
      },
    },
  ],
});

export const encodeText = (text: string): string => {
  assertWellFormedUtf16(text, "text");
  let encoded = "";
  for (let index = 0; index < text.length; index++) {
    const codeUnit = text[index]!;
    encoded += isReserved(codeUnit) ? `${TEXT_ESCAPE}${codeUnit}` : codeUnit;
  }
  return encoded;
};

export const toGraphEvent = (event: RichTextEvent): GraphEvent => ({
  id: event.id,
  parentVersion: new Set(event.parentVersion),
  timestamp: event.timestamp,
  operation: { ...event.operation },
});

export const fromGraphEvent = (
  event: GraphEvent,
  effect: RichTextEffect,
): RichTextEvent => ({
  schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
  id: event.id,
  parentVersion: [...event.parentVersion].sort(compareIds),
  timestamp: event.timestamp,
  operation: { ...event.operation },
  effect,
});

export const parseBatch = (input: unknown): RichTextEventBatch => {
  const batch = asRecord(input, "batch");
  if (batch.schemaVersion !== BLOCK_MODEL_SCHEMA_VERSION) {
    throw new Error("Unsupported rich-text batch schemaVersion");
  }
  const batchId = asNonEmptyString(batch.batchId, "batchId");
  const parentVersion = parseVersion(batch.parentVersion, "parentVersion");
  if (!Array.isArray(batch.events) || batch.events.length === 0) {
    throw new Error("Rich-text batch events must be a non-empty array");
  }
  const events = batch.events.map((event, index) =>
    parseEvent(event, `events[${index}]`),
  );
  if (batchId !== events[0]!.id && batchId !== BOOTSTRAP_BATCH_ID) {
    throw new Error("batchId must equal the first event ID");
  }
  if (!versionsEqual(parentVersion, events[0]!.parentVersion)) {
    throw new Error("Batch parentVersion must equal its first event parents");
  }
  const eventIds = new Set<string>();
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    if (eventIds.has(event.id)) {
      throw new Error(`Duplicate event ID in batch: ${event.id}`);
    }
    eventIds.add(event.id);
    if (
      index > 0 &&
      (event.parentVersion.length !== 1 ||
        event.parentVersion[0] !== events[index - 1]!.id)
    ) {
      throw new Error("Rich-text batch events must form a strict causal chain");
    }
  }
  const parsed = deepFreezeBatch({
    schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
    batchId,
    parentVersion,
    events,
  });
  if (batchId === BOOTSTRAP_BATCH_ID && !sameBatch(parsed, BOOTSTRAP_BATCH)) {
    throw new Error("Invalid deterministic bootstrap batch");
  }
  return parsed;
};

export const sameBatch = (
  left: RichTextEventBatch,
  right: RichTextEventBatch,
): boolean => JSON.stringify(left) === JSON.stringify(right);

export const cloneBatch = (batch: RichTextEventBatch): RichTextEventBatch =>
  parseBatch(JSON.parse(JSON.stringify(batch)) as unknown);

export const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const normalizeFields = (
  type: BlockType,
  attrs: BlockAttributePatch = {},
): CompleteBlockFields => ({
  type,
  parentId: attrs.parentId ?? null,
  language: attrs.language ?? null,
  theme: attrs.theme ?? null,
  start: attrs.start ?? null,
  value: attrs.value ?? null,
  checked: attrs.checked ?? null,
});

export const assertFieldPatch = (patch: BlockFieldPatch): void => {
  if (patch.type !== undefined && !BLOCK_TYPES.has(patch.type)) {
    throw new Error(`Unsupported block type ${String(patch.type)}`);
  }
  assertOptionalNullableString(patch.parentId, "parentId");
  assertOptionalNullableString(patch.language, "language");
  assertOptionalNullableString(patch.theme, "theme");
  assertOptionalNullableSafeInteger(patch.start, "start");
  assertOptionalNullableSafeInteger(patch.value, "value");
  if (
    patch.checked !== undefined &&
    patch.checked !== null &&
    typeof patch.checked !== "boolean"
  ) {
    throw new Error("checked must be a boolean or null");
  }
};

export const isBlockType = (value: unknown): value is BlockType =>
  typeof value === "string" && BLOCK_TYPES.has(value);

export const isMarkKind = (value: unknown): value is MarkKind =>
  typeof value === "string" && MARK_KINDS.has(value);

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

const isSafeLinkUrl = (url: string): boolean => {
  try {
    const { protocol } = new URL(url, "http://localhost");
    return SAFE_LINK_PROTOCOLS.has(protocol);
  } catch {
    return false;
  }
};

export const isLinkAttributes = (value: unknown): value is LinkAttributes => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const link = value as Record<string, unknown>;
  return (
    typeof link.url === "string" &&
    isSafeLinkUrl(link.url) &&
    optionalString(link.target) &&
    optionalString(link.rel) &&
    optionalString(link.title)
  );
};

export const isReserved = (codeUnit: string): boolean =>
  codeUnit === BLOCK_MARKER ||
  codeUnit === METADATA_MARKER ||
  codeUnit === TEXT_ESCAPE;

const parseEvent = (input: unknown, label: string): RichTextEvent => {
  const event = asRecord(input, label);
  if (event.schemaVersion !== BLOCK_MODEL_SCHEMA_VERSION) {
    throw new Error(`${label}.schemaVersion is unsupported`);
  }
  const id = asNonEmptyString(event.id, `${label}.id`);
  const parentVersion = parseVersion(
    event.parentVersion,
    `${label}.parentVersion`,
  );
  const timestamp = asSafeInteger(event.timestamp, `${label}.timestamp`);
  const operation = parseOperation(event.operation, `${label}.operation`);
  const effect = parseEffect(event.effect, `${label}.effect`);
  assertEffectCarrier(id, operation, effect);
  return Object.freeze({
    schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
    id,
    parentVersion,
    timestamp,
    operation,
    effect,
  });
};

const parseOperation = (
  input: unknown,
  label: string,
): SerializedTextOperation => {
  const operation = asRecord(input, label);
  if (operation.type === "insert") {
    const index = asNonNegativeSafeInteger(operation.index, `${label}.index`);
    const text = asNonEmptyString(operation.text, `${label}.text`);
    assertWellFormedUtf16(text, `${label}.text`);
    return Object.freeze({ type: "insert", index, text });
  }
  if (operation.type === "delete") {
    const index = asNonNegativeSafeInteger(operation.index, `${label}.index`);
    const length = asNonNegativeSafeInteger(
      operation.length,
      `${label}.length`,
    );
    if (length === 0) {
      throw new Error(`${label}.length must be positive`);
    }
    return Object.freeze({ type: "delete", index, length });
  }
  throw new Error(`${label}.type is invalid`);
};

const parseEffect = (input: unknown, label: string): RichTextEffect => {
  const effect = asRecord(input, label);
  switch (effect.type) {
    case "bootstrap":
      return Object.freeze({
        type: "bootstrap",
        blockId: asNonEmptyString(effect.blockId, `${label}.blockId`),
        fields: parseCompleteFields(effect.fields, `${label}.fields`),
      });
    case "block-create":
      return Object.freeze({
        type: "block-create",
        blockId: asNonEmptyString(effect.blockId, `${label}.blockId`),
        sourceBlockId:
          effect.sourceBlockId === null
            ? null
            : asNonEmptyString(effect.sourceBlockId, `${label}.sourceBlockId`),
        fields: parseCompleteFields(effect.fields, `${label}.fields`),
      });
    case "text-insert": {
      const text = asNonEmptyString(effect.text, `${label}.text`);
      assertWellFormedUtf16(text, `${label}.text`);
      return Object.freeze({
        type: "text-insert",
        blockId: asNonEmptyString(effect.blockId, `${label}.blockId`),
        text,
      });
    }
    case "text-delete":
    case "block-join":
    case "block-delete":
      return Object.freeze({
        type: effect.type,
        blockId: asNonEmptyString(effect.blockId, `${label}.blockId`),
      });
    case "block-set": {
      const fields = parseFieldPatch(effect.fields, `${label}.fields`);
      if (Object.keys(fields).length === 0) {
        throw new Error(`${label}.fields cannot be empty`);
      }
      return Object.freeze({
        type: "block-set",
        blockId: asNonEmptyString(effect.blockId, `${label}.blockId`),
        fields,
      });
    }
    case "mark-set": {
      if (!isMarkKind(effect.kind)) {
        throw new Error(`${label}.kind is invalid`);
      }
      const range = asRecord(effect.range, `${label}.range`);
      if (!isSequenceAnchor(range.start) || !isSequenceAnchor(range.end)) {
        throw new Error(`${label}.range contains an invalid anchor`);
      }
      const value = parseMarkValue(effect.kind, effect.value, `${label}.value`);
      return Object.freeze({
        type: "mark-set",
        blockId: asNonEmptyString(effect.blockId, `${label}.blockId`),
        kind: effect.kind,
        value,
        range: Object.freeze({
          start: cloneSequenceAnchor(range.start),
          end: cloneSequenceAnchor(range.end),
        }),
      });
    }
    default:
      throw new Error(`${label}.type is invalid`);
  }
};

const cloneSequenceAnchor = (anchor: SequenceAnchor): SequenceAnchor => {
  if (anchor.type === "atom") {
    return Object.freeze({
      type: "atom",
      eventId: anchor.eventId,
      offset: anchor.offset,
      affinity: anchor.affinity,
    });
  }
  return anchor.edge === "start"
    ? Object.freeze({ type: "boundary", edge: "start", affinity: "after" })
    : Object.freeze({ type: "boundary", edge: "end", affinity: "before" });
};

const parseCompleteFields = (
  input: unknown,
  label: string,
): CompleteBlockFields => {
  const fields = asRecord(input, label);
  if (!isBlockType(fields.type)) {
    throw new Error(`${label}.type is invalid`);
  }
  const patch = parseFieldPatch(fields, label);
  const complete = normalizeFields(fields.type, patch);
  if (Object.keys(fields).length !== 7) {
    throw new Error(`${label} must contain every block field`);
  }
  return Object.freeze(complete);
};

const parseFieldPatch = (input: unknown, label: string): BlockFieldPatch => {
  const fields = asRecord(input, label);
  const allowed = new Set([
    "type",
    "parentId",
    "language",
    "theme",
    "start",
    "value",
    "checked",
  ]);
  for (const key of Object.keys(fields)) {
    if (!allowed.has(key)) {
      throw new Error(`${label}.${key} is unsupported`);
    }
  }
  const patch: {
    type?: BlockType;
    parentId?: string | null;
    language?: string | null;
    theme?: string | null;
    start?: number | null;
    value?: number | null;
    checked?: boolean | null;
  } = {};
  if (fields.type !== undefined) {
    if (!isBlockType(fields.type)) {
      throw new Error(`${label}.type is invalid`);
    }
    patch.type = fields.type;
  }
  if (fields.parentId !== undefined) {
    patch.parentId = parseNullableString(fields.parentId, `${label}.parentId`);
  }
  if (fields.language !== undefined) {
    patch.language = parseNullableString(fields.language, `${label}.language`);
  }
  if (fields.theme !== undefined) {
    patch.theme = parseNullableString(fields.theme, `${label}.theme`);
  }
  if (fields.start !== undefined) {
    patch.start = parseNullableSafeInteger(fields.start, `${label}.start`);
  }
  if (fields.value !== undefined) {
    patch.value = parseNullableSafeInteger(fields.value, `${label}.value`);
  }
  if (fields.checked !== undefined) {
    if (fields.checked !== null && typeof fields.checked !== "boolean") {
      throw new Error(`${label}.checked must be boolean or null`);
    }
    patch.checked = fields.checked;
  }
  assertFieldPatch(patch);
  return Object.freeze(patch);
};

const parseMarkValue = (
  kind: MarkKind,
  input: unknown,
  label: string,
): true | LinkAttributes | null => {
  if (input === null) {
    return null;
  }
  if (kind === "link") {
    if (!isLinkAttributes(input)) {
      throw new Error(`${label} must be link attributes or null`);
    }
    return Object.freeze({
      url: input.url,
      ...(input.target === undefined ? {} : { target: input.target }),
      ...(input.rel === undefined ? {} : { rel: input.rel }),
      ...(input.title === undefined ? {} : { title: input.title }),
    });
  }
  if (input !== true) {
    throw new Error(`${label} must be true or null`);
  }
  return true;
};

const assertEffectCarrier = (
  eventId: string,
  operation: SerializedTextOperation,
  effect: RichTextEffect,
): void => {
  if (effect.type === "bootstrap" || effect.type === "block-create") {
    if (operation.type !== "insert" || operation.text !== BLOCK_MARKER) {
      throw new Error(`${effect.type} requires a raw block marker insert`);
    }
    return;
  }
  if (effect.type === "text-insert") {
    if (
      operation.type !== "insert" ||
      operation.text !== encodeText(effect.text)
    ) {
      throw new Error("text-insert carrier disagrees with encoded text");
    }
    return;
  }
  if (effect.type === "text-delete") {
    if (operation.type !== "delete") {
      throw new Error("text-delete requires a raw delete carrier");
    }
    return;
  }
  if (operation.type !== "insert" || operation.text !== METADATA_MARKER) {
    throw new Error(`${effect.type} requires a metadata marker insert`);
  }
  if (eventId === BOOTSTRAP_EVENT_ID) {
    throw new Error("Bootstrap event ID cannot carry metadata");
  }
};

const parseVersion = (input: unknown, label: string): ReadonlyArray<string> => {
  if (!Array.isArray(input)) {
    throw new Error(`${label} must be an array`);
  }
  const version = input.map((id, index) =>
    asNonEmptyString(id, `${label}[${index}]`),
  );
  if (new Set(version).size !== version.length) {
    throw new Error(`${label} contains duplicate event IDs`);
  }
  return Object.freeze([...version].sort(compareIds));
};

const versionsEqual = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean =>
  left.length === right.length &&
  left.every((eventId, index) => eventId === right[index]);

function deepFreezeBatch(batch: RichTextEventBatch): RichTextEventBatch {
  return Object.freeze({
    ...batch,
    parentVersion: Object.freeze([...batch.parentVersion]),
    events: Object.freeze(
      batch.events.map((event) =>
        Object.freeze({
          ...event,
          parentVersion: Object.freeze([...event.parentVersion]),
          operation: Object.freeze({ ...event.operation }),
          effect: Object.freeze({ ...event.effect }),
        }),
      ),
    ),
  });
}

const asRecord = (input: unknown, label: string): Record<string, unknown> => {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
};

const asNonEmptyString = (input: unknown, label: string): string => {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return input;
};

const asSafeInteger = (input: unknown, label: string): number => {
  if (!Number.isSafeInteger(input)) {
    throw new Error(`${label} must be a safe integer`);
  }
  return input as number;
};

const asNonNegativeSafeInteger = (input: unknown, label: string): number => {
  const value = asSafeInteger(input, label);
  if (value < 0) {
    throw new Error(`${label} must be non-negative`);
  }
  return value;
};

const parseNullableString = (input: unknown, label: string): string | null => {
  if (input === null) {
    return null;
  }
  return asNonEmptyString(input, label);
};

const parseNullableSafeInteger = (
  input: unknown,
  label: string,
): number | null =>
  input === null ? null : asNonNegativeSafeInteger(input, label);

const assertOptionalNullableString = (
  value: string | null | undefined,
  label: string,
): void => {
  if (value !== undefined && value !== null && value.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
};

const assertOptionalNullableSafeInteger = (
  value: number | null | undefined,
  label: string,
): void => {
  if (
    value !== undefined &&
    value !== null &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error(`${label} must be a non-negative safe integer or null`);
  }
};

const optionalString = (value: unknown): boolean =>
  value === undefined || typeof value === "string";

const assertWellFormedUtf16 = (text: string, label: string): void => {
  for (let index = 0; index < text.length; index++) {
    const current = text.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`${label} contains an unpaired high surrogate`);
      }
      index++;
    } else if (current >= 0xdc00 && current <= 0xdfff) {
      throw new Error(`${label} contains an unpaired low surrogate`);
    }
  }
};
