import { CilError } from '../../binary.js';

export const verificationMemberDiagnosticCatalog = Object.freeze({
  CILVM0001: 'Invalid verification member metadata',
  CILVM0002: 'Verification member metadata limit exceeded',
  CILVM0003: 'Verification member query cancelled',
  CILVM0004: 'Member identity does not belong to this verification context',
});

export function rejectMember(code, detail = '') {
  const error = new CilError(`${verificationMemberDiagnosticCatalog[code]}${detail ? `: ${detail}` : ''}`);
  error.code = code;
  throw error;
}

export function memberBudget(options) {
  const signal = options.signal;
  const limits = {};
  const maxima = { maxMembers: 65535, maxMemberBytes: 1048576, maxMemberSignatureNodes: 65536, maxDepth: 256, maxQueryNodes: 4096 };
  for (const [name, maximum] of Object.entries(maxima)) {
    const value = options[name] ?? maximum;
    if (!Number.isInteger(value) || value < 0 || value > maximum) rejectMember('CILVM0002', name);
    limits[name] = value;
  }
  return { ...limits, check() { if (signal?.aborted) rejectMember('CILVM0003'); } };
}

export function metadataOperation(operation) {
  try { return operation(); } catch (error) {
    if (!(error instanceof CilError) || error.code) throw error;
    rejectMember('CILVM0001', error.message);
  }
}

export function requireMemberToken(token, counts, tables = [4, 6, 10, 43]) {
  if (!Number.isInteger(token) || token < 0 || token > 0xffffffff) rejectMember('CILVM0001', 'member token');
  const table = token >>> 24;
  const row = token & 0xffffff;
  if (!tables.includes(table) || !row || row > (counts[table] ?? 0)) rejectMember('CILVM0001', 'member token extent');
  return token;
}
