import { decodeCoded } from '@sharpforge/cil';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const invalid = message => loadError(LoadErrorCode.InvalidImage, message);

/** Decode a bounded MethodImpl-related coded token without allowing an overflowing RID to change its table. */
export function methodImplToken(module, kind, coded) {
  const bits = kind === 'MethodDefOrRef' ? 1 : 3;
  if (!Number.isInteger(coded) || coded < 1 || coded >= 0x1000000 * 2 ** bits) {
    throw invalid(`Invalid MethodImpl ${kind} encoding`);
  }
  let token;
  try { token = decodeCoded(kind, coded); }
  catch { throw invalid(`Invalid MethodImpl ${kind} token`); }
  const rid = token & 0xffffff;
  if (!rid || rid > module.rowCount(token >>> 24)) throw invalid(`Invalid MethodImpl ${kind} extent`);
  return token;
}

/** Shared module-local MethodImpl ownership index; callers apply their own declaration-binding policy. */
export class MethodImplementationRows {
  #maxRows;
  #modules = new WeakMap();
  constructor(maxRows) { this.#maxRows = maxRows; }

  forType(type, signal) {
    const module = type.module;
    if (!this.#modules.has(module)) this.#index(module, signal);
    return this.#modules.get(module).get(type.metadataToken & 0xffffff) ?? [];
  }

  #index(module, signal) {
    const count = module.rowCount(25);
    if (count > this.#maxRows) throw loadError(LoadErrorCode.LimitExceeded, 'MethodImpl row limit exceeded');
    const owners = new Map();
    const typeCount = module.rowCount(2);
    for (let rid = 1; rid <= count; rid++) {
      checkCancellation(signal);
      const row = module.row(0x19000000 + rid);
      if (!Number.isInteger(row[0]) || row[0] < 1 || row[0] > typeCount) throw invalid('Invalid MethodImpl owner');
      if (!owners.has(row[0])) owners.set(row[0], []);
      owners.get(row[0]).push(row);
    }
    this.#modules.set(module, owners);
  }
}
