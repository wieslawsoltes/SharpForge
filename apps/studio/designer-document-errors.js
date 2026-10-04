/** Cleanup must retain the construction failure and report secondary cleanup errors without replacing its cause. */
export function disposeFailedDesigner(error, dispose) {
  try {
    dispose();
  } catch (cleanupError) {
    return new AggregateError([error, cleanupError], error?.message ?? String(error), {cause: error});
  }
  return error;
}
