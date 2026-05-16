/**
 * Runtime type guards for untrusted presence payloads.
 *
 * These guards validate the shape of payloads received from external
 * transports (WebSocket frames, BroadcastChannel messages) before they reach
 * presence-state operations. Both adapters share the same field-level shape
 * for `CursorPosition`, `SelectionRange`, and `PointerPosition`, so the
 * guards live here as a single source of truth.
 */

import type {
  CursorPosition,
  PointerPosition,
  SelectionRange,
} from "./presence";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isCursorPosition = (value: unknown): value is CursorPosition =>
  isRecord(value) &&
  typeof value.blockId === "string" &&
  typeof value.offset === "number" &&
  (value.anchor === undefined || typeof value.anchor === "string");

export const isSelectionRange = (value: unknown): value is SelectionRange =>
  isRecord(value) &&
  typeof value.blockId === "string" &&
  typeof value.from === "number" &&
  typeof value.to === "number" &&
  (value.fromAnchor === undefined || typeof value.fromAnchor === "string") &&
  (value.toAnchor === undefined || typeof value.toAnchor === "string");

export const isPointerPosition = (value: unknown): value is PointerPosition =>
  isRecord(value) &&
  typeof value.x === "number" &&
  typeof value.y === "number" &&
  (value.space === "viewport" || value.space === "document");
