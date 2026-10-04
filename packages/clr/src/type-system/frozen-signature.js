import { decodeSignature } from '@sharpforge/cil';
import { loadError, LoadErrorCode } from '../load-errors.js';

/** Freeze an owned signature AST after bounded decoding. */
export function freezeSignature(node) {
  if (!node || typeof node !== 'object' || Object.isFrozen(node)) return node;
  for (const value of Object.values(node)) freezeSignature(value);
  return Object.freeze(node);
}

/** Read a field/property AST with a pre-copy 1 MiB limit, preserving lazy SFCLR diagnostics. */
export function readFrozenSignature(module, index, kind) {
  try {
    const signature = decodeSignature(module.blob(index, { maxBytes: 1024 * 1024 }));
    if (signature.kind !== kind) throw loadError(LoadErrorCode.InvalidImage, `Expected a ${kind} signature`);
    return freezeSignature(signature);
  } catch (error) {
    if (error.code?.startsWith('SFCLR')) throw error;
    throw loadError(LoadErrorCode.InvalidImage, `Invalid ${kind} signature: ${error.message}`);
  }
}
