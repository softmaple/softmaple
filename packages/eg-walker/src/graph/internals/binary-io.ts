export const BINARY_MAGIC = new Uint8Array([0x45, 0x47, 0x57, 0x33]); // EGW3

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

  readVarint(): number {
    let value = 0;
    let multiplier = 1;
    // A safe-integer (53-bit) value encodes to at most 8 continuation bytes
    // plus 1 terminating byte. Reject anything longer up front so a crafted
    // payload can't loop the decoder over arbitrary input.
    const MAX_BYTES = 9;

    for (let bytesRead = 0; bytesRead < MAX_BYTES; bytesRead++) {
      if (this.offset >= this.bytes.length) {
        throw new Error("Unexpected end of varint");
      }
      const byte = this.bytes[this.offset++]!;

      value += (byte & 0x7f) * multiplier;
      // Even within MAX_BYTES, a high-bit-set byte combined with a large
      // multiplier can carry the partial result past Number.MAX_SAFE_INTEGER,
      // where integer arithmetic silently loses precision. Fail loudly
      // instead of returning a corrupted number.
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

  readString(): string {
    return decodeText(this.readBytes(this.readVarint()));
  }

  readStringArray(): string[] {
    const length = this.readVarint();
    return Array.from({ length }, () => this.readString());
  }

  readBytes(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new Error("Unexpected end of binary eg-walker graph");
    }
    const result = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
}
