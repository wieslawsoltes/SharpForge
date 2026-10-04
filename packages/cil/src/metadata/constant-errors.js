import { CilError } from '../binary.js';

export const constantDiagnosticCatalog = Object.freeze({
  MD0120: 'Invalid Constant element type',
  MD0121: 'Invalid Constant value',
  MD0122: 'Invalid Constant blob length',
  MD0123: 'Constant size limit exceeded',
  MD0124: 'Constant operation cancelled',
  MD0125: 'Invalid Constant parent',
  MD0126: 'Duplicate Constant parent',
  MD0127: 'Invalid Constant table',
});

export function constantError(code, message = constantDiagnosticCatalog[code]) {
  const error = new CilError(message);
  error.code = code;
  return error;
}
