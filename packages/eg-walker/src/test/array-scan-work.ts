import { vi } from "vitest";

/**
 * Charge array membership scans and copies by their input size during a
 * synchronous operation. This catches quadratic native-array work that an
 * item-lookup counter misses, without a machine-dependent timing threshold.
 * Callers use fresh keys, so membership searches must exhaust their arrays.
 */
export const measureArrayScanWork = (action: () => void): number => {
  let work = 0;
  const includes = Array.prototype.includes;
  const slice = Array.prototype.slice;
  const includesSpy = vi
    .spyOn(Array.prototype, "includes")
    .mockImplementation(function (
      this: unknown[],
      value: unknown,
      fromIndex?: number,
    ): boolean {
      work += this.length;
      return includes.call(this, value, fromIndex);
    });
  const sliceSpy = vi
    .spyOn(Array.prototype, "slice")
    .mockImplementation(function (
      this: unknown[],
      start?: number,
      end?: number,
    ): unknown[] {
      work += this.length;
      return slice.call(this, start, end);
    });
  try {
    action();
  } finally {
    includesSpy.mockRestore();
    sliceSpy.mockRestore();
  }
  return work;
};
