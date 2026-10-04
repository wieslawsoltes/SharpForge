import { CilError } from '../../binary.js';

export const verificationTypeSystemDiagnosticCatalog = Object.freeze({
  CILVT0001: 'Invalid verification type metadata',
  CILVT0002: 'Verification type-system limit exceeded',
  CILVT0003: 'Verification type-system query cancelled',
  CILVT0004: 'Type identity does not belong to this verification adapter',
});

export function rejectTypeSystem(code, detail = '') {
  const error = new CilError(`${verificationTypeSystemDiagnosticCatalog[code]}${detail ? `: ${detail}` : ''}`);
  error.code = code;
  throw error;
}

export const known = value => Object.freeze({ status: 'known', value });
export const unknown = (reason, token = null) => Object.freeze({ status: 'unknown', reason, token });
export const yes = known(true);
export const no = known(false);

export function typeSystemBudget(options) {
  if (!options || typeof options !== 'object') rejectTypeSystem('CILVT0002', 'options');
  const limits = {};
  for (const [name, maximum] of Object.entries({ maxTypes: 65535, maxEdges: 65535, maxQueryNodes: 4096, maxDepth: 256 })) {
    const value = options[name] ?? maximum;
    if (!Number.isInteger(value) || value < 0 || value > maximum) rejectTypeSystem('CILVT0002', name);
    limits[name] = value;
  }
  return Object.freeze({ ...limits, check() {
    if (options.signal?.aborted) rejectTypeSystem('CILVT0003');
  } });
}
