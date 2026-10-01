/**
 * EGW4 wire format.
 *
 * Every varint is an unsigned LEB128 safe integer; a zigzag varint maps a
 * signed value `v` to `2v` (v >= 0) or `-2v - 1` (v < 0) first. Events are
 * stored in topological order, and an event's position in that order is its
 * offset.
 *
 * ```text
 * magic       varint 4, then "EGW4"
 * eventCount  varint N, at most EGW4_MAX_EVENTS
 * strings     varint count, then each string as varint UTF-8 length + bytes:
 *             every replica ID and custom event ID, written once
 * idRuns      runs covering the N events in order:
 *               varint stringIndex * 2 + custom
 *               canonical: varint length * 2 + jumped
 *                          [varint startSequence, when jumped]
 *               custom:    one event whose ID is the string itself
 *             A canonical run that has not jumped starts at the sequence
 *             after its replica's previous run, or at 0.
 * parents     varint override count, then per override in offset order:
 *               varint gap * 4 + code   gap = offset - previous offset - 1
 *               code 0-2: that many parents; 3: varint parentCount - 3
 *               per parent: varint offset - parentOffset
 *             An event without an override has the previous event as its
 *             only parent, or no parent at offset 0.
 * lengths     unsigned runs covering N values, each the event's insert text
 *             length or delete length:
 *               varint count * 2 + literal
 *               repeat: varint value; literal: count values
 * operations  spans covering the N events in order:
 *               varint count * 4 + kind, zigzag varint anchor - cursor
 *             kind 0 (insert): event i + 1 inserts where event i ended; the
 *               anchor is the first index.
 *             kind 1 (delete): every event deletes at the anchor.
 *             kind 2 (delete): backspace; event i + 1 ends where event i
 *               starts, and the anchor is where the first event ends.
 *             The cursor starts at 0 and moves to where an insert span ended,
 *             to a delete span's anchor, or to a backspace span's last index.
 *             anchor - cursor is taken modulo 2^53 into -2^52 to 2^52 - 1,
 *             so its zigzag varint is safe for any two positions up to
 *             Number.MAX_SAFE_INTEGER.
 * content     bytes: LZ4 frame of the inserted text, as UTF-8, in event order
 * timestamps  delta segments covering N values:
 *               varint count * 4 + mode
 *               mode 0: zigzag first delta; the next count - 1 values each
 *                       add the step
 *               mode 1: like mode 0, after a zigzag varint new step
 *               mode 2: count zigzag deltas
 *             Deltas are from the previous value (0 first); the step starts
 *             at 0.
 * metadata    string: a JSON object
 * checksum    CRC-32 of every earlier byte, as uint32 little-endian
 * ```
 *
 * A keystroke trace therefore costs a few bytes per typing or backspace span
 * plus its compressed text, and a concurrent trace a few bytes per run of
 * consecutive IDs and per merge. IDs and parents are numbers on the wire, so
 * decoding never builds an ID string per event.
 */

/** Operation span kinds. */
export const EGW4_SPAN = {
  INSERT: 0,
  DELETE: 1,
  BACKSPACE: 2,
} as const;

/** Delta segment modes. */
export const EGW4_SEGMENT = {
  SAME_STEP: 0,
  NEW_STEP: 1,
  LITERAL: 2,
} as const;

/** A parent override's code for "the parent count follows". */
export const EGW4_MANY_PARENTS = 3;

/** Shortest run of equal values that an unsigned run column repeats. */
export const EGW4_MIN_REPEAT = 3;

/** Bytes of the trailing CRC-32. */
export const EGW4_CHECKSUM_BYTES = 4;

/**
 * Most events an EGW4 payload holds (33,554,432, 14 times the largest paper
 * trace). Runs let a few bytes declare many events, and decoding allocates
 * about 17 bytes of columns per declared event, so the limit bounds what any
 * payload can make the decoder allocate. Encoders refuse larger graphs, so
 * every payload they write decodes.
 */
export const EGW4_MAX_EVENTS = 2 ** 25;

/** Span positions wrap modulo 2^53, the count of non-negative safe integers. */
const POSITION_MODULUS = 2 ** 53;
const HALF_POSITION_MODULUS = 2 ** 52;

/**
 * `anchor - cursor` modulo 2^53, from -2^52 to 2^52 - 1, for two positions
 * from 0 to `Number.MAX_SAFE_INTEGER`.
 */
export const wrapAnchorDelta = (anchor: number, cursor: number): number => {
  const delta = anchor - cursor;
  if (delta >= HALF_POSITION_MODULUS) {
    return delta - POSITION_MODULUS;
  }
  if (delta < -HALF_POSITION_MODULUS) {
    return delta + POSITION_MODULUS;
  }
  return delta;
};

/**
 * The position from 0 to `Number.MAX_SAFE_INTEGER` that a wrapped `delta`
 * takes `cursor` to. Every intermediate value stays safe, so it is exact.
 */
export const unwrapAnchor = (cursor: number, delta: number): number => {
  if (delta >= 0) {
    const headroom = POSITION_MODULUS - cursor;
    return delta < headroom ? cursor + delta : delta - headroom;
  }
  const anchor = cursor + delta;
  return anchor >= 0 ? anchor : anchor + POSITION_MODULUS;
};
