const INT32_MIN = -0x8000_0000;
const INT32_MAX = 0x7fff_ffff;
const UINT32_MAX = 0xffff_ffff;

/** Compact storage for a validated non-negative safe-integer column. */
export type PackedUnsignedIntegerColumn = Uint32Array | Float64Array;

/** Compact storage for a validated signed safe-integer column. */
export type PackedIntegerColumn = Int32Array | Uint32Array | Float64Array;

/**
 * Narrow a validated non-negative safe-integer column when every value fits.
 *
 * Callers validate values before reaching this persistence boundary. Returning
 * the original Float64Array for a wide value preserves the full safe-integer
 * EGW3 wire range without an extra allocation.
 */
export const compactUnsignedIntegerColumn = (
  values: PackedUnsignedIntegerColumn,
): PackedUnsignedIntegerColumn => {
  if (values instanceof Uint32Array) return values;
  for (const value of values) {
    if (value > UINT32_MAX) return values;
  }
  return new Uint32Array(values);
};

/**
 * Narrow a validated signed safe-integer column when every value fits one
 * 32-bit representation. Negative columns prefer Int32Array; non-negative
 * columns may use Uint32Array for the additional high bit.
 */
export const compactIntegerColumn = (
  values: PackedIntegerColumn,
): PackedIntegerColumn => {
  if (!(values instanceof Float64Array)) return values;
  let fitsInt32 = true;
  let fitsUint32 = true;
  for (const value of values) {
    if (value < INT32_MIN || value > INT32_MAX) fitsInt32 = false;
    if (value < 0 || value > UINT32_MAX) fitsUint32 = false;
    if (!fitsInt32 && !fitsUint32) return values;
  }
  if (fitsInt32) return new Int32Array(values);
  return new Uint32Array(values);
};
