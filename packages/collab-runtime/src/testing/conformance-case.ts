/**
 * A single named conformance assertion. Kept assertion-library-free so this
 * directory stays free of `vitest` (the collab-runtime lint allowlist
 * rejects it like any other bare specifier); a host wraps each case with
 * its own test runner, e.g. `for (const c of suite) it(c.name, c.run)`.
 */
export interface ConformanceCase {
  readonly name: string;
  run(): Promise<void>;
}

export function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]),
    );
  }
  return false;
};

export const checkEqual = <T>(
  actual: T,
  expected: T,
  message: string,
): void => {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
};

/** Runs `fn`, returning the thrown value, or throws if `fn` did not reject. */
export const expectRejection = async (
  fn: () => Promise<unknown>,
  message: string,
): Promise<unknown> => {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error(message);
};
