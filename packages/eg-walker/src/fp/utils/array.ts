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
  return array.reduce(
    (groups, item) => {
      const key = keyFn(item);
      return {
        ...groups,
        [key]: [...(groups[key] || []), item],
      };
    },
    {} as Record<K, T[]>,
  );
};

/**
 * Partition array based on a predicate
 */
export const partition = <T>(
  array: readonly T[],
  predicate: (item: T) => boolean,
): [T[], T[]] => {
  return array.reduce(
    ([pass, fail], item) =>
      predicate(item) ? [[...pass, item], fail] : [pass, [...fail, item]],
    [[] as T[], [] as T[]],
  );
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
  arrays.reduce<T[]>((flat, arr) => [...flat, ...arr], []);
