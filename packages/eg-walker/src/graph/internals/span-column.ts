const BLOCK_SHIFT = 10;
const BLOCK_SIZE = 1 << BLOCK_SHIFT;
const BLOCK_MASK = BLOCK_SIZE - 1;
const EMPTY_VALUES = new Float64Array(0);

type DenseBlock = Uint32Array | Float64Array;
type NumericArray = DenseBlock | Int32Array | Uint8Array;
type Block =
  | DenseBlock
  | {
      readonly ends: Uint16Array;
      readonly values: DenseBlock;
      readonly steps: Int8Array | Float64Array;
    };

interface SpanCursor {
  start: number;
  end: number;
  value: number;
  step: number;
}

/**
 * Numeric columns with bounded random access and an appendable last block.
 * Blocks contain at most 1,024 values, bounding a lookup even for literals.
 * Sealed blocks use constant-step spans (as in EGW4's timestamp segments),
 * or literal values when spans would be larger. Only exact safe-integer
 * arithmetic is compressed; fractions, infinities, NaN and -0 stay literal.
 * A block never references the source buffer, so sealing releases spare
 * capacity. Truncation reopens at most one block.
 */
export class SpanColumn {
  private blocks: Block[] = [];
  private pending = EMPTY_VALUES;
  private count = 0;
  private readonly cursor: SpanCursor = { start: 0, end: 0, value: 0, step: 0 };
  private sealed: {
    readonly offsets: Uint32Array;
    readonly data: DataView;
  } | null = null;

  static from(values: ArrayLike<number>): SpanColumn {
    const column = new SpanColumn();
    if (values.length > 0) column.pending = new Float64Array(BLOCK_SIZE);
    for (let start = 0; start < values.length; start += BLOCK_SIZE) {
      const count = Math.min(BLOCK_SIZE, values.length - start);
      if (
        count === BLOCK_SIZE &&
        (values instanceof Uint8Array ||
          values instanceof Uint32Array ||
          values instanceof Int32Array ||
          values instanceof Float64Array)
      ) {
        column.blocks.push(seal(values.subarray(start, start + BLOCK_SIZE)));
      } else {
        for (let index = 0; index < count; index++)
          column.pending[index] = values[start + index]!;
        if (count === BLOCK_SIZE) column.blocks.push(seal(column.pending));
      }
    }
    column.count = values.length;
    column.packBlocks();
    return column;
  }

  get length(): number {
    return this.count;
  }

  append(value: number): void {
    const offset = this.count & BLOCK_MASK;
    if (offset >= this.pending.length) {
      const pending = new Float64Array(
        Math.min(BLOCK_SIZE, Math.max(16, this.pending.length * 2)),
      );
      pending.set(this.pending);
      this.pending = pending;
    }
    this.pending[offset] = value;
    this.count++;
    if (offset === BLOCK_MASK) this.blocks.push(seal(this.pending));
  }

  at(index: number): number {
    const cursor = this.cursor;
    if (index >= cursor.start && index < cursor.end)
      return cursor.value + (index - cursor.start) * cursor.step;
    const block = index >>> BLOCK_SHIFT;
    const offset = index & BLOCK_MASK;
    const sealedCount = (this.sealed?.offsets.length ?? 1) - 1;
    if (block < sealedCount)
      return readPackedBlock(
        this.sealed!.data,
        this.sealed!.offsets[block]!,
        offset,
        cursor,
        index - offset,
      );
    return block === sealedCount + this.blocks.length
      ? this.pending[offset]!
      : readBlock(
          this.blocks[block - sealedCount]!,
          offset,
          cursor,
          index - offset,
        );
  }

  truncate(count: number): void {
    if (count === this.count) return;
    if (!Number.isSafeInteger(count) || count < 0 || count > this.count)
      throw new RangeError("Invalid column truncation");
    const block = count >>> BLOCK_SHIFT;
    const length = count & BLOCK_MASK;
    const sealedCount = (this.sealed?.offsets.length ?? 1) - 1;
    if (block < sealedCount + this.blocks.length) {
      for (let offset = 0; offset < length; offset++)
        this.pending[offset] = this.at(block * BLOCK_SIZE + offset);
      if (block < sealedCount) {
        const { offsets, data } = this.sealed!;
        this.sealed = {
          offsets: offsets.slice(0, block + 1),
          data: new DataView(data.buffer.slice(0, offsets[block]!)),
        };
        this.blocks = [];
      } else this.blocks.length = block - sealedCount;
    }
    this.count = count;
    this.cursor.end = 0;
  }

  /** Coalesce sealed buffers so a received trace retains no per-block objects. */
  private packBlocks(): void {
    const offsets = new Uint32Array(this.blocks.length + 1);
    let size = 0;
    for (let i = 0; i < this.blocks.length; i++) {
      offsets[i] = size;
      const block = this.blocks[i]!;
      size +=
        block instanceof Uint32Array || block instanceof Float64Array
          ? 1 + block.byteLength
          : 3 +
            block.ends.byteLength +
            block.values.byteLength +
            block.steps.byteLength;
    }
    offsets[this.blocks.length] = size;
    const data = new DataView(new ArrayBuffer(size));
    const bytes = new Uint8Array(data.buffer);
    for (let i = 0; i < this.blocks.length; i++) {
      const block = this.blocks[i]!;
      let at = offsets[i]!;
      if (block instanceof Uint32Array || block instanceof Float64Array) {
        data.setUint8(at++, block instanceof Uint32Array ? 0 : 1);
        bytes.set(
          new Uint8Array(block.buffer, block.byteOffset, block.byteLength),
          at,
        );
      } else {
        data.setUint8(
          at++,
          2 |
            (block.values instanceof Float64Array ? 4 : 0) |
            (block.steps instanceof Float64Array ? 8 : 0),
        );
        data.setUint16(at, block.ends.length, true);
        at += 2;
        for (const column of [block.ends, block.values, block.steps]) {
          bytes.set(
            new Uint8Array(column.buffer, column.byteOffset, column.byteLength),
            at,
          );
          at += column.byteLength;
        }
      }
    }
    this.sealed = { offsets, data };
    this.blocks = [];
  }

  /** Materialize a transient view for consumers that require dense columns. */
  toArray(): Float64Array {
    const values = new Float64Array(this.count);
    this.copyTo(values);
    return values;
  }

  copyTo(values: Uint8Array | Uint32Array | Int32Array | Float64Array): void {
    for (let index = 0; index < this.count; index++)
      values[index] = this.at(index);
  }
}

const readBlock = (
  block: Block,
  offset: number,
  cursor: SpanCursor,
  origin: number,
): number => {
  if (block instanceof Uint32Array || block instanceof Float64Array)
    return block[offset]!;
  const { ends, values, steps } = block;
  let low = 0;
  let high = ends.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offset < ends[middle]!) high = middle;
    else low = middle + 1;
  }
  const start = low === 0 ? 0 : ends[low - 1]!;
  cursor.start = origin + start;
  cursor.end = origin + ends[low]!;
  cursor.value = values[low]!;
  cursor.step = steps[low]!;
  return cursor.value + (offset - start) * cursor.step;
};

const seal = (values: NumericArray): Block => {
  let integer = !(values instanceof Float64Array);
  let narrow = true;
  if (!(values instanceof Uint32Array || values instanceof Uint8Array))
    for (const value of values) {
      if (
        !Number.isInteger(value) ||
        value < 0 ||
        value > 0xffff_ffff ||
        Object.is(value, -0)
      ) {
        narrow = false;
        break;
      }
    }
  integer ||= narrow;
  const ends: number[] = [];
  const anchors: number[] = [];
  const steps: number[] = [];
  let narrowSteps = true;
  for (let start = 0; start < BLOCK_SIZE; ) {
    const first = values[start]!;
    const step = start + 1 < BLOCK_SIZE ? values[start + 1]! - first : 0;
    if (
      !integer &&
      (!Number.isSafeInteger(first) ||
        Object.is(first, -0) ||
        !Number.isSafeInteger(step))
    )
      return narrow ? new Uint32Array(values) : new Float64Array(values);
    let end = start + 1;
    while (end < BLOCK_SIZE) {
      const delta = (end - start) * step;
      const value = values[end]!;
      if (
        first + delta !== value ||
        (!integer &&
          (!Number.isSafeInteger(delta) ||
            !Number.isSafeInteger(value) ||
            Object.is(value, -0)))
      )
        break;
      end++;
    }
    ends.push(end);
    anchors.push(first);
    steps.push(step);
    if (step < -128 || step > 127) narrowSteps = false;
    // Include the typed-array headers before choosing a span block.
    if (
      ends.length * (2 + (narrow ? 4 : 8) + (narrowSteps ? 1 : 8)) + 192 >=
      BLOCK_SIZE * (narrow ? 4 : 8)
    )
      return narrow ? new Uint32Array(values) : new Float64Array(values);
    start = end;
  }
  return {
    ends: new Uint16Array(ends),
    values: narrow ? new Uint32Array(anchors) : new Float64Array(anchors),
    steps: narrowSteps ? new Int8Array(steps) : new Float64Array(steps),
  };
};

/** The packed buffer uses the host byte order, just like its source typed arrays. */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

const readPackedBlock = (
  data: DataView,
  start: number,
  offset: number,
  cursor: SpanCursor,
  origin: number,
): number => {
  const kind = data.getUint8(start++);
  if (kind === 0) return data.getUint32(start + offset * 4, LITTLE_ENDIAN);
  if (kind === 1) return data.getFloat64(start + offset * 8, LITTLE_ENDIAN);
  const count = data.getUint16(start, true);
  start += 2;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offset < data.getUint16(start + middle * 2, LITTLE_ENDIAN))
      high = middle;
    else low = middle + 1;
  }
  const first =
    low === 0 ? 0 : data.getUint16(start + (low - 1) * 2, LITTLE_ENDIAN);
  const width = kind & 4 ? 8 : 4;
  const anchors = start + count * 2;
  const value =
    width === 8
      ? data.getFloat64(anchors + low * width, LITTLE_ENDIAN)
      : data.getUint32(anchors + low * width, LITTLE_ENDIAN);
  const steps = anchors + count * width;
  const step =
    kind & 8
      ? data.getFloat64(steps + low * 8, LITTLE_ENDIAN)
      : data.getInt8(steps + low);
  cursor.start = origin + first;
  cursor.end = origin + data.getUint16(start + low * 2, LITTLE_ENDIAN);
  cursor.value = value;
  cursor.step = step;
  return value + (offset - first) * step;
};
