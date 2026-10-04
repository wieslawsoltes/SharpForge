/** Larger fixtures are opt-in; the standard baseline continues to end at 100 MiB. */
export const editorBenchmarkMaxSize = 256 * 1024 ** 2;

export function validateFixtureSize(sizeBytes) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 256 || sizeBytes > editorBenchmarkMaxSize) {
    throw new RangeError('Editor fixtures must contain 256 bytes through 256 MiB');
  }
  return sizeBytes;
}
