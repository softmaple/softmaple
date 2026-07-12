import { PersistentUtf16Rope } from "../../text/persistent-utf16-rope";

export type RecordContent = string | RopeRecordContent;

/** Immutable view over a checkpoint rope used by replay placeholders. */
export class RopeRecordContent {
  private constructor(
    private readonly rope: PersistentUtf16Rope,
    private readonly start: number,
    private readonly end: number,
  ) {}

  static from(rope: PersistentUtf16Rope): RopeRecordContent {
    return new RopeRecordContent(rope, 0, rope.length);
  }

  get length(): number {
    return this.end - this.start;
  }

  charCodeAt(index: number): number {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) {
      return Number.NaN;
    }
    return this.rope.codeUnitAt(this.start + index) ?? Number.NaN;
  }

  slice(start: number, end: number = this.length): RopeRecordContent {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.length
    ) {
      throw new Error(
        `Invalid rope record slice [${start}, ${end}) for length ${this.length}`,
      );
    }
    return new RopeRecordContent(
      this.rope,
      this.start + start,
      this.start + end,
    );
  }

  materialize(start: number = 0, end: number = this.length): string {
    return this.slice(start, end).toString();
  }

  toString(): string {
    return this.rope.slice(this.start, this.end);
  }
}

export const materializeRecordContent = (
  content: RecordContent,
  start: number = 0,
  end: number = content.length,
): string =>
  typeof content === "string"
    ? content.slice(start, end)
    : content.materialize(start, end);
