/**
 * Functional array utilities
 * Pure functions for array manipulation
 */

/**
 * Group array elements by a key function
 */
export const groupBy = <T, K extends string | number>(
  array: readonly T[],
  keyFn: (item: T) => K,
): Record<K, T[]> => {
  const groups: Record<K, T[]> = {} as Record<K, T[]>;
  for (const item of array) {
    const key = keyFn(item);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
  }
  return groups;
};

/**
 * Partition array based on a predicate
 */
export const partition = <T>(
  array: readonly T[],
  predicate: (item: T) => boolean,
): [T[], T[]] => {
  const pass: T[] = [];
  const fail: T[] = [];
  for (const item of array) {
    if (predicate(item)) {
      pass.push(item);
    } else {
      fail.push(item);
    }
  }
  return [pass, fail];
};

/**
 * Take n elements from array
 */
export const take =
  <T>(n: number) =>
  (array: readonly T[]): T[] =>
    array.slice(0, n);

/**
 * Drop n elements from array
 */
export const drop =
  <T>(n: number) =>
  (array: readonly T[]): T[] =>
    array.slice(n);

/**
 * Zip two arrays together safely
 */
export const zip = <A, B>(
  as: readonly A[],
  bs: readonly B[],
): Array<[A, B]> => {
  const length = Math.min(as.length, bs.length);
  const result: Array<[A, B]> = [];
  for (let i = 0; i < length; i++) {
    const a = as[i];
    const b = bs[i];
    if (a !== undefined && b !== undefined) {
      result.push([a, b]);
    }
  }
  return result;
};

/**
 * Find first element matching predicate
 */
export const find = <T>(
  array: readonly T[],
  predicate: (item: T) => boolean,
): T | undefined => {
  for (const item of array) {
    if (predicate(item)) return item;
  }
  return undefined;
};

/**
 * Check if array is empty
 */
export const isEmpty = <T>(array: readonly T[]): boolean => array.length === 0;

/**
 * Get first element safely
 */
export const head = <T>(array: readonly T[]): T | undefined => array[0];

/**
 * Get last element safely
 */
export const last = <T>(array: readonly T[]): T | undefined =>
  array[array.length - 1];

/**
 * Flatten nested arrays one level
 */
export const flatten = <T>(arrays: readonly (readonly T[])[]): T[] =>
  arrays.flat();
