/** Studio opts into large source buffers; callers outside Studio retain the project-system defaults. */
export const studioDiskLimits = Object.freeze({
  maxFiles: 20_000,
  maxFileBytes: 256 * 1024 * 1024,
  maxAssemblyBytes: 256 * 1024 * 1024,
  maxTotalBytes: 320 * 1024 * 1024
});

/** Validate decoded source lengths in UTF-16 code units before replacing the current workspace. */
export function validateStudioSources(sources) {
  if (!Array.isArray(sources) || sources.length > studioDiskLimits.maxFiles) {
    throw new RangeError('Studio supports at most 20,000 source files in one workspace');
  }
  let total = 0;
  for (const source of sources) {
    if (typeof source.text !== 'string') throw new TypeError('A source document must contain text');
    if (source.text.length > studioDiskLimits.maxFileBytes) throw new RangeError('A source exceeds the editor buffer limit');
    total += source.text.length;
    if (total > studioDiskLimits.maxTotalBytes) throw new RangeError('The workspace exceeds the total source buffer limit');
  }
  return sources;
}
