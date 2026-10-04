import { createParameterDesc } from './parameter-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

const invalid = message => loadError(LoadErrorCode.InvalidImage, message);

/** Explicit module-owned parameter and Constant caches; signatures supply omitted Param rows. */
export class MetadataParameters {
  #module;
  #bounded = false;
  #methods = new Map();
  #owners = new Map();
  #descriptorCount = 0;
  constructor(module) { this.#module = module; }

  #checkLimits() {
    if (this.#bounded) return;
    if ([7, 8, 11].reduce((count, table) => count + this.#module.rowCount(table), 0) > 100000) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Parameter metadata row limit exceeded');
    }
    this.#bounded = true;
  }

  #read(operation) {
    try { return operation(); }
    catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      const code = error.code === 'MD0123' ? LoadErrorCode.LimitExceeded : LoadErrorCode.InvalidImage;
      throw loadError(code, `Invalid parameter metadata: ${error.message}`);
    }
  }

  #rows(method, parameterCount) {
    const rows = new Map();
    const tokens = new Set();
    for (const token of this.#module.list(method.metadataToken, 'ParamList')) {
      const prior = this.#owners.get(token);
      if (token >>> 24 !== 8 || !(token & 0xffffff) || tokens.has(token) || (prior && prior !== method.metadataToken)) {
        throw invalid('Invalid or duplicate parameter ownership');
      }
      const [flags, sequence, nameIndex] = this.#module.row(token);
      if (sequence > parameterCount || rows.has(sequence)) throw invalid('Invalid or duplicate parameter sequence');
      const name = this.#module.string(nameIndex, { maxBytes: 4096 });
      rows.set(sequence, { token, flags, name });
      tokens.add(token);
    }
    return rows;
  }

  forMethod(token) {
    if (this.#methods.has(token)) return this.#methods.get(token);
    return this.#read(() => {
      this.#checkLimits();
      const method = this.#module.methodDefinition(token);
      const signature = method.signature;
      const required = signature.parameters.length + 1;
      if (required > 100000 - this.#descriptorCount) {
        throw loadError(LoadErrorCode.LimitExceeded, 'Parameter descriptor limit exceeded');
      }
      const rows = this.#rows(method, signature.parameters.length);
      const parameter = (sequence, signatureType) => createParameterDesc({ reader: this, method, signatureType,
        position: sequence - 1, token: 0, flags: 0, name: null, ...rows.get(sequence) });
      const result = Object.freeze({
        parameters: Object.freeze(signature.parameters.map((type, index) => parameter(index + 1, type))),
        returnParameter: parameter(0, signature.returnType),
      });
      for (const row of rows.values()) this.#owners.set(row.token, token);
      this.#methods.set(token, result);
      this.#descriptorCount += required;
      return result;
    });
  }

  /** Raw Constant values share the module index with fields and properties. */
  constant(token) {
    return token ? this.#module.constant(token) : null;
  }
}
