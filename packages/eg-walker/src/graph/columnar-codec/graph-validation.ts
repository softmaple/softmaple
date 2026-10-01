/** Validation shared by the columnar decoders. */

export const strictEventIdSet = (
  value: unknown,
  context: string,
): Set<string> => {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  const result = new Set<string>();
  for (const id of value) {
    if (typeof id !== "string" || id.length === 0 || result.has(id)) {
      throw new Error(`${context} contains an invalid event ID`);
    }
    result.add(id);
  }
  return result;
};

export const strictMetadata = (value: unknown): Record<string, unknown> => {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Columnar graph metadata must be an object");
  }
  return { ...(value as Record<string, unknown>) };
};

export const sameEventIds = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean => {
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
};
