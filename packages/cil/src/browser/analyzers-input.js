import { CilError } from '../binary.js';
import { readMethodHeader } from '../pe.js';

const maxima = { maxMethods: 16384, maxCodeBytes: 4 * 1024 * 1024, maxMethodCodeBytes: 1024 * 1024,
  maxInstructions: 250000, maxUsages: 100000, maxDeclarationRelations: 100000, maxDeclarationDiagnostics: 16384 };
export const invalidUsage = detail => { throw new CilError(`Invalid usage analysis: ${detail}`); };
export const usageLimit = detail => { throw new CilError(`Usage analysis limit exceeded: ${detail}`); };
export function usageCancelled(signal) {
  if (signal?.aborted) throw new CilError('Usage analysis cancelled');
}
export function usageLimits(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalidUsage('options');
  const limits = {};
  for (const [key, maximum] of Object.entries(maxima)) {
    const value = options[key] ?? maximum;
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) invalidUsage(key);
    limits[key] = value;
  }
  usageCancelled(options.signal);
  return limits;
}
export function usageToken(counts, token, tables) {
  if (!Number.isInteger(token) || token < 1 || token > 0xffffffff || !tables.includes(token >>> 24)
    || !(token & 0xffffff) || (token & 0xffffff) > (counts[token >>> 24] ?? 0)) invalidUsage('metadata token');
  return token;
}

/** Charge every body occurrence, including shared RVAs, before IL or member snapshots allocate. */
export function usageHeaders(inspector, limits, signal) {
  const metadata = inspector.metadata, count = metadata.rows[6]?.length ?? 0;
  if (count > limits.maxMethods) usageLimit('methods');
  const headers = [], diagnostics = [];
  let codeBytes = 0;
  for (let rid = 1; rid <= count; rid++) {
    usageCancelled(signal);
    const token = 0x06000000 + rid, row = metadata.row(token), implementation = row[1];
    if (!Number.isInteger(implementation) || implementation < 0 || implementation > 0xffff) invalidUsage('method implementation');
    if (implementation & 3) {
      diagnostics.push({ token, reason: 'non-cil-method' });
      continue;
    }
    const header = readMethodHeader(inspector.pe, token);
    if (!header) continue;
    codeBytes += header.codeSize;
    if (header.codeSize > limits.maxMethodCodeBytes || codeBytes > limits.maxCodeBytes) usageLimit('code bytes');
    headers.push({ token, offset: header.codeOffset, size: header.codeSize });
  }
  return { headers, diagnostics, methods: count, codeBytes };
}
