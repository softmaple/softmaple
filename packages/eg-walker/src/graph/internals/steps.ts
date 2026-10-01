/**
 * Work split into bounded steps, for a caller that must pause between them:
 * each `next()` runs one step, and the generator returns the result.
 *
 * A step boundary only lets the caller stop for a while. The work does the
 * same thing however its steps are run, so a synchronous caller runs them
 * back to back with {@link runSteps}.
 */
export type Steps<T> = Generator<void, T, void>;

/** Run every remaining step of `steps` and return the result. */
export const runSteps = <T>(steps: Steps<T>): T => {
  let step = steps.next();
  while (step.done !== true) {
    step = steps.next();
  }
  return step.value;
};
