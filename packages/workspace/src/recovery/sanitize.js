const secretField = /(?:password|secret|credential|authorization|token|api.?key|trust|permission|origin.?grant)/i;

/** Strip authority and credentials recursively; restored settings never grant native execution or network access. */
export function sanitizeRecoveryValue(value, depth = 0) {
  if (depth > 64) throw new Error('SFW1301: Recovery nesting limit exceeded');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (value instanceof Uint8Array) return value.slice();
  if (Array.isArray(value)) return value.map(item => sanitizeRecoveryValue(item, depth + 1));
  if (typeof value !== 'object') return undefined;
  const result = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (secretField.test(key) || ['__proto__', 'constructor', 'prototype', 'client', 'nativeHost', 'handle'].includes(key)) continue;
    const clean = sanitizeRecoveryValue(item, depth + 1);
    if (clean !== undefined) result[key] = clean;
  }
  return result;
}
