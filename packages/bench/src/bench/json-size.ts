/**
 * Exact UTF-8 byte length of `JSON.stringify(value)` without building it.
 *
 * The persistence lane reports the JSON payload size of `EgWalkerReplica`'s
 * `serialize()`. On the largest maintained trace that payload is ~459 MB, and
 * materializing it cost ~875 MB of heap for the UTF-16 string plus another
 * ~459 MB for the encoder's byte view: a ~1.7 GiB spike on a lane that already
 * runs close to the worker's heap limit. Walking the value instead keeps the
 * largest transient string at one event.
 *
 * The walk mirrors `JSON.stringify`'s own rules, so the result is the byte
 * length that method would have produced:
 *
 * - a `toJSON` method replaces the value before serialization;
 * - `undefined`, functions, and symbols become `null` inside an array and drop
 *   their key inside an object;
 * - object keys are visited in insertion order, as `JSON.stringify` does.
 *
 * Returns `0` when `JSON.stringify` itself would return `undefined`.
 */

import { Buffer } from "node:buffer";

const NULL_BYTES = 4;
const BRACKET_BYTES = 2;
const SEPARATOR_BYTES = 1;

const isOmitted = (value: unknown): boolean =>
  value === undefined ||
  typeof value === "function" ||
  typeof value === "symbol";

const scalarByteLength = (value: unknown): number => {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 0 : Buffer.byteLength(encoded, "utf8");
};

const unwrap = (value: unknown): unknown =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as { toJSON?: unknown }).toJSON === "function"
    ? (value as { toJSON(): unknown }).toJSON()
    : value;

export const jsonByteLength = (input: unknown): number => {
  const value = unwrap(input);
  if (isOmitted(value)) {
    return 0;
  }
  if (Array.isArray(value)) {
    let bytes = BRACKET_BYTES;
    for (let index = 0; index < value.length; index++) {
      if (index > 0) {
        bytes += SEPARATOR_BYTES;
      }
      const entry = unwrap(value[index]);
      bytes += isOmitted(entry) ? NULL_BYTES : jsonByteLength(entry);
    }
    return bytes;
  }
  if (value !== null && typeof value === "object") {
    let bytes = BRACKET_BYTES;
    let first = true;
    for (const [key, entry] of Object.entries(value)) {
      const resolved = unwrap(entry);
      if (isOmitted(resolved)) {
        continue;
      }
      if (!first) {
        bytes += SEPARATOR_BYTES;
      }
      first = false;
      bytes +=
        scalarByteLength(key) + SEPARATOR_BYTES + jsonByteLength(resolved);
    }
    return bytes;
  }
  return scalarByteLength(value);
};
