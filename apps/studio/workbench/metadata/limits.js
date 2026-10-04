export const metadataLimits = Object.freeze({bytes: 32 * 1024 * 1024, sources: 512, assemblies: 32, symbols: 50_000,
  cachedSymbols: 100_000, text: 8 * 1024 * 1024, definition: 1024 * 1024, timeoutMs: 15_000});

export function metadataError(code, message) {
  return Object.assign(new Error(message), {code});
}

export function boundedMetadataText(value) {
  const text = String(value ?? '');
  if (text.length > 16_384) throw metadataError('METADATA_TEXT_LIMIT', 'A metadata name or signature exceeds 16,384 characters');
  return text;
}
