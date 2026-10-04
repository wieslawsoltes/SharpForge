import {normalizeCallType} from './generic-signatures.js';

/** Match finite builtin declarations with the metadata reader's retained source aliases. */
export function builtinSignatureType(type) {
  return normalizeCallType(type === 'Array' ? 'System.Array' : type.replace(/^decimal(?=&|$)/, 'System.Decimal'));
}
