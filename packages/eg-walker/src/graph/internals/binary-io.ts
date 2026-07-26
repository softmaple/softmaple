import type {
  PackedIntegerColumn,
  PackedUnsignedIntegerColumn,
} from "./packed-numeric-columns";

export const BINARY_MAGIC = new Uint8Array([0x45, 0x47, 0x57, 0x33]); // EGW3

const textEncoder = new TextEncoder();
// `ignoreBOM: true` means "treat a leading UTF-8 BOM as content" in the
// Encoding API. Inserted text may legitimately begin with U+FEFF, so the
// persistence codec must not silently discard it.
const textDecoder = new TextDecoder("utf-8", { ignoreBOM: true });

export const encodeText = (value: string): Uint8Array =>
  textEncoder.encode(value);

export const decodeText = (bytes: Uint8Array): string =>
  textDecoder.decode(bytes);

export const toUint8Array = (
  bytes: ReadonlyArray<number> | Uint8Array,
): Uint8Array => (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

/**
 * Zigzag encoding maps signed integers to non-negative integers:
 * `0 -> 0, -1 -> 1, 1 -> 2, -2 -> 3, 2 -> 4, ...`. Uses safe-integer
 * arithmetic rather than bitwise ops so values beyond +/-2^31 round-trip
 * correctly.
 */
const zigzagEncode = (value: number): number =>
  value >= 0 ? value * 2 : value * -2 - 1;

const zigzagDecode = (value: number): number =>
  value % 2 === 0 ? value / 2 : -((value + 1) / 2);

export class BinaryWriter {
  private buffer = new Uint8Array(256);
  private size = 0;

  writeVarint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Cannot encode invalid varint value ${value}`);
    }

    let remaining = value;
    while (remaining >= 0x80) {
      this.writeByte((remaining % 0x80) + 0x80);
      remaining = Math.floor(remaining / 0x80);
    }
    this.writeByte(remaining);
  }

  writeVarintArray(values: ReadonlyArray<number>): void {
    this.writeVarint(values.length);
    for (const value of values) {
      this.writeVarint(value);
    }
  }

  writeZigZagVarint(value: number): void {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Cannot encode invalid zigzag varint value ${value}`);
    }
    this.writeVarint(zigzagEncode(value));
  }

  writeZigZagDeltaArray(values: ReadonlyArray<number>): void {
    this.writeVarint(values.length);
    let previous = 0;
    for (const value of values) {
      this.writeZigZagVarint(value - previous);
      previous = value;
    }
  }

  writeString(value: string): void {
    this.writeBytes(encodeText(value));
  }

  writeStringArray(values: ReadonlyArray<string>): void {
    this.writeVarint(values.length);
    for (const value of values) {
      this.writeString(value);
    }
  }

  writeBytes(bytes: Uint8Array): void {
    this.writeVarint(bytes.length);
    this.ensureCapacity(this.size + bytes.length);
    this.buffer.set(bytes, this.size);
    this.size += bytes.length;
  }

  toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.size);
  }

  private writeByte(byte: number): void {
    this.ensureCapacity(this.size + 1);
    this.buffer[this.size++] = byte;
  }

  private ensureCapacity(required: number): void {
    if (required <= this.buffer.length) {
      return;
    }
    let nextCapacity = this.buffer.length * 2;
    while (nextCapacity < required) {
      nextCapacity *= 2;
    }
    const next = new Uint8Array(nextCapacity);
    next.set(this.buffer);
    this.buffer = next;
  }
}

export class BinaryReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remainingByteLength(): number {
    return this.bytes.length - this.offset;
  }

  readVarint(): number {
    let value = 0;
    let multiplier = 1;
    // 8 bytes carry 56 bits (7 per byte), more than enough for any value
    // <= Number.MAX_SAFE_INTEGER (53 bits). Reject longer payloads up front
    // so a crafted overlong encoding can't loop the decoder over arbitrary
    // input.
    const MAX_BYTES = 8;

    for (let bytesRead = 0; bytesRead < MAX_BYTES; bytesRead++) {
      if (this.offset >= this.bytes.length) {
        throw new Error("Unexpected end of varint");
      }
      const byte = this.bytes[this.offset++]!;

      value += (byte & 0x7f) * multiplier;
      // Even within MAX_BYTES, a high-bit-set byte combined with a large
      // multiplier can carry the partial result past Number.MAX_SAFE_INTEGER,
      // where the addition above silently loses low bits to double-precision
      // rounding. The comparison itself is still reliable — any rounded
      // result above the safe range stays above MAX_SAFE_INTEGER (2^53 - 1)
      // — so we fail loudly here instead of returning a corrupted number.
      if (value > Number.MAX_SAFE_INTEGER) {
        throw new Error("Varint exceeds Number.MAX_SAFE_INTEGER");
      }
      if ((byte & 0x80) === 0) {
        return value;
      }
      multiplier *= 0x80;
    }

    throw new Error(
      `Varint exceeds maximum encoded length of ${MAX_BYTES} bytes`,
    );
  }

  readVarintArray(): number[] {
    const length = this.readVarint();
    return Array.from({ length }, () => this.readVarint());
  }

  readVarintUint32Array(): Uint32Array {
    const length = this.readVarint();
    if (length > this.remainingByteLength) {
      throw new Error("Unexpected end of varint array");
    }
    const values = new Uint32Array(length);
    for (let index = 0; index < length; index++) {
      const value = this.readVarint();
      if (value > 0xffffffff) {
        throw new Error("Varint exceeds Uint32 range");
      }
      values[index] = value;
    }
    return values;
  }

  readVarintPackedUnsignedArray(): PackedUnsignedIntegerColumn {
    const length = this.readVarint();
    if (length > this.remainingByteLength) {
      throw new Error("Unexpected end of varint array");
    }
    let values: PackedUnsignedIntegerColumn = new Uint32Array(length);
    for (let index = 0; index < length; index++) {
      const value = this.readVarint();
      if (value > 0xffff_ffff && values instanceof Uint32Array) {
        const wideValues = new Float64Array(length);
        wideValues.set(values.subarray(0, index));
        values = wideValues;
      }
      values[index] = value;
    }
    return values;
  }

  readZigZagVarint(): number {
    return zigzagDecode(this.readVarint());
  }

  readZigZagDeltaArray(): number[] {
    const length = this.readVarint();
    const values: number[] = new Array<number>(length);
    let previous = 0;
    for (let i = 0; i < length; i++) {
      const value = previous + this.readZigZagVarint();
      values[i] = value;
      previous = value;
    }
    return values;
  }

  readZigZagDeltaUint32Array(): Uint32Array {
    const length = this.readVarint();
    const out = new Uint32Array(length);
    let previous = 0;
    for (let index = 0; index < length; index++) {
      const value = previous + this.readZigZagVarint();
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new Error(`Invalid uint32 delta value ${value}`);
      }
      out[index] = value;
      previous = value;
    }
    return out;
  }

  readZigZagDeltaPackedUnsignedArray(): PackedUnsignedIntegerColumn {
    const length = this.readVarint();
    if (length > this.remainingByteLength) {
      throw new Error("Unexpected end of zigzag delta array");
    }
    let values: PackedUnsignedIntegerColumn = new Uint32Array(length);
    let previous = 0;
    for (let index = 0; index < length; index++) {
      const value = previous + this.readZigZagVarint();
      if (!Number.isSafeInteger(value)) {
        throw new Error(`Invalid safe-integer delta value ${value}`);
      }
      if ((value < 0 || value > 0xffff_ffff) && values instanceof Uint32Array) {
        const wideValues = new Float64Array(length);
        wideValues.set(values.subarray(0, index));
        values = wideValues;
      }
      values[index] = value;
      previous = value;
    }
    return values;
  }

  readZigZagDeltaPackedIntegerArray(): PackedIntegerColumn {
    const length = this.readVarint();
    if (length > this.remainingByteLength) {
      throw new Error("Unexpected end of zigzag delta array");
    }
    let values: PackedIntegerColumn = new Int32Array(length);
    let previous = 0;
    let hasNegativeValue = false;
    for (let index = 0; index < length; index++) {
      const value = previous + this.readZigZagVarint();
      if (!Number.isSafeInteger(value)) {
        throw new Error(`Invalid safe-integer delta value ${value}`);
      }
      if (values instanceof Int32Array) {
        if (value < -0x8000_0000 || value > 0x7fff_ffff) {
          const widerValues: Uint32Array | Float64Array =
            !hasNegativeValue && value >= 0 && value <= 0xffff_ffff
              ? new Uint32Array(length)
              : new Float64Array(length);
          widerValues.set(values.subarray(0, index));
          values = widerValues;
        }
      } else if (
        values instanceof Uint32Array &&
        (value < 0 || value > 0xffff_ffff)
      ) {
        const wideValues = new Float64Array(length);
        wideValues.set(values.subarray(0, index));
        values = wideValues;
      }
      values[index] = value;
      hasNegativeValue ||= value < 0;
      previous = value;
    }
    return values;
  }

  readString(): string {
    return decodeText(this.readBytes(this.readVarint()));
  }

  readStringArray(): string[] {
    const length = this.readVarint();
    return Array.from({ length }, () => this.readString());
  }

  readBytes(length: number): Uint8Array {
    return this.readByteView(length).slice();
  }

  readByteView(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new Error("Unexpected end of binary eg-walker graph");
    }
    const result = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
}
