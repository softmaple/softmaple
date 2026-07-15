import {
  containsUtf16SurrogateCodeUnit,
  PersistentUtf16Rope,
  type Utf16RopeAssembler,
} from "../../text/persistent-utf16-rope";

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

  /**
   * Conservative for sliced views: inspecting the shared rope root avoids
   * materialising the slice and can only keep the replay boundary guard on.
   */
  get hasSurrogateCodeUnits(): boolean {
    return this.rope.hasSurrogateCodeUnits;
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

  /**
   * Expose this view as a persistent rope slice. Fully-covered leaves retain
   * their identity, allowing a replay result to share checkpoint storage.
   */
  toRope(): PersistentUtf16Rope {
    return this.rope.sliceRope(this.start, this.end);
  }

  /** Append this shared view without first constructing a temporary rope. */
  appendTo(assembler: Utf16RopeAssembler): void {
    assembler.appendSlice(this.rope, this.start, this.end);
  }

  /** Append a subrange of this shared view without materialising it. */
  appendRangeTo(
    assembler: Utf16RopeAssembler,
    start: number,
    end: number,
  ): void {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.length
    ) {
      throw new Error(
        `Invalid rope record append range [${start}, ${end}) for length ${this.length}`,
      );
    }
    assembler.appendSlice(this.rope, this.start + start, this.start + end);
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

export const recordContentHasSurrogateCodeUnits = (
  content: RecordContent,
): boolean =>
  typeof content === "string"
    ? containsUtf16SurrogateCodeUnit(content)
    : content.hasSurrogateCodeUnits;
