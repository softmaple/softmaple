/**
 * Function composition utilities
 * Tools for composing and combining functions
 */

/**
 * Compose two functions
 */
export const compose =
  <A, B, C>(f: (b: B) => C, g: (a: A) => B) =>
  (x: A): C =>
    f(g(x));

/**
 * Pipe functions from left to right
 */
export const pipe =
  <T>(...fns: Array<(x: T) => T>) =>
  (value: T): T =>
    fns.reduce((v, fn) => fn(v), value);

/**
 * Memoize a function with a single argument
 */
export const memoize = <T, R>(
  fn: (arg: T) => R,
  keyFn: (arg: T) => string = JSON.stringify,
): ((arg: T) => R) => {
  const cache = new Map<string, R>();
  return (arg: T): R => {
    const key = keyFn(arg);
    if (cache.has(key)) {
      return cache.get(key) as R;
    }
    const result = fn(arg);
    cache.set(key, result);
    return result;
  };
};

/**
 * Curry a binary function
 */
export const curry2 =
  <A, B, R>(fn: (a: A, b: B) => R) =>
  (a: A) =>
  (b: B): R =>
    fn(a, b);

/**
 * Curry a ternary function
 */
export const curry3 =
  <A, B, C, R>(fn: (a: A, b: B, c: C) => R) =>
  (a: A) =>
  (b: B) =>
  (c: C): R =>
    fn(a, b, c);

/**
 * Identity function
 */
export const identity = <T>(x: T): T => x;

/**
 * Constant function
 */
export const constant =
  <T>(value: T) =>
  (): T =>
    value;

/**
 * Delay execution
 */
export const delay =
  (ms: number) =>
  <T>(value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(value), ms));
