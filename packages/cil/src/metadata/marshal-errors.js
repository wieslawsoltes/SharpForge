import { CilError } from '../binary.js';

export const marshalDiagnosticCatalog = Object.freeze({
  MD0130: 'Malformed native marshal descriptor',
  MD0131: 'Unsupported native marshal type',
  MD0132: 'Native marshal descriptor size limit exceeded',
  MD0133: 'Native marshal descriptor operation cancelled',
});

export function marshalError(code, message = marshalDiagnosticCatalog[code], offset) {
  const error = new CilError(message, offset);
  error.code = code;
  return error;
}
