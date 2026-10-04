import { decodeCoded, decodeConstant } from '@sharpforge/cil';
import { loadError, LoadErrorCode } from '../load-errors.js';

const flags = new Map([[4, 0x8000], [8, 0x1000], [23, 0x1000]]);
const invalid = message => loadError(LoadErrorCode.InvalidImage, message);

/** One module's Constant index. Owner tables validate independently, preserving lazy Param diagnostics. */
export class MetadataConstants {
  #module;
  #tables;
  #validated = new Set();
  #values = new Map();
  constructor(module) { this.#module = module; }

  #index(table) {
    if (!this.#tables) {
      if (this.#module.rowCount(11) > 100000) throw loadError(LoadErrorCode.LimitExceeded, 'Constant row limit exceeded');
      const tables = new Map();
      for (let rid = 1; rid <= this.#module.rowCount(11); rid++) {
        const [type, parent, blob] = this.#module.row(0x0b000000 + rid);
        const token = decodeCoded('HasConstant', parent);
        const owner = token >>> 24;
        if (!flags.has(owner)) continue;
        if (!tables.has(owner)) tables.set(owner, new Map());
        const entries = tables.get(owner);
        entries.set(token, { type, blob, duplicate: entries.has(token) });
      }
      this.#tables = tables;
    }
    const entries = this.#tables.get(table);
    if (!this.#validated.has(table)) {
      for (const [token, entry] of entries ?? []) {
        if (!(token & 0xffffff) || (token & 0xffffff) > this.#module.rowCount(table) || entry.duplicate) {
          throw invalid('Invalid or duplicate Constant owner');
        }
      }
      this.#validated.add(table);
    }
    return entries;
  }

  /** Frozen raw {type, value}, or null; no enum boxing or custom-attribute default interpretation. */
  get(token) {
    if (this.#values.has(token)) return this.#values.get(token);
    try {
      if (!Number.isInteger(token) || token < 0 || token > 0xffffffff || !flags.has(token >>> 24) || !(token & 0xffffff)) {
        throw invalid('Constant lookup requires a Field, Param or Property token');
      }
      const table = token >>> 24;
      if (this.#module.rowCount(table) > 100000) throw loadError(LoadErrorCode.LimitExceeded, 'Constant owner row limit exceeded');
      const row = this.#module.row(token);
      const constant = this.#index(table)?.get(token);
      if (Boolean(row[0] & flags.get(table)) !== Boolean(constant)) throw invalid('HasDefault flag and Constant row disagree');
      const value = constant ? Object.freeze({ type: constant.type,
        value: decodeConstant(constant.type, this.#module.blob(constant.blob, { maxBytes: 1024 * 1024 })) }) : null;
      this.#values.set(token, value);
      return value;
    } catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      const code = error.code === 'MD0123' ? LoadErrorCode.LimitExceeded : LoadErrorCode.InvalidImage;
      throw loadError(code, `Invalid Constant metadata: ${error.message}`);
    }
  }
}
