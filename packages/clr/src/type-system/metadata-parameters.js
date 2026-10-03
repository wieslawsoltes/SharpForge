import { decodeCoded, decodeConstant } from '@sharpforge/cil';
import { createParameterDesc } from './parameter-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

const invalid = message => loadError(LoadErrorCode.InvalidImage, message);

/** Explicit module-owned parameter and Constant caches; signatures supply omitted Param rows. */
export class MetadataParameters {
  #module;
  #bounded = false;
  #methods = new Map();
  #owners = new Map();
  #constants;
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
      const name = nameIndex ? this.#module.string(nameIndex) : null;
      if (name?.length > 4096) throw loadError(LoadErrorCode.LimitExceeded, 'Parameter name length exceeded');
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

  #constantRows() {
    if (this.#constants) return this.#constants;
    this.#checkLimits();
    const constants = new Map();
    for (let rid = 1; rid <= this.#module.rowCount(11); rid++) {
      const [type, parent, blob] = this.#module.row(0x0b000000 + rid);
      const token = decodeCoded('HasConstant', parent);
      if (token >>> 24 !== 8) continue;
      if (!(token & 0xffffff) || (token & 0xffffff) > this.#module.rowCount(8) || constants.has(token)) {
        throw invalid('Invalid or duplicate parameter Constant owner');
      }
      constants.set(token, { type, blob });
    }
    this.#constants = constants;
    return constants;
  }

  /** Only raw CLI Constant rows are interpreted; no enum binding or custom-attribute default evaluation occurs. */
  constant(token, flags) {
    if (!token) return null;
    return this.#read(() => {
      const constant = this.#constantRows().get(token);
      if (Boolean(flags & 0x1000) !== Boolean(constant)) throw invalid('Param HasDefault flag and Constant row disagree');
      if (!constant) return null;
      return Object.freeze({ type: constant.type, value: decodeConstant(constant.type, this.#module.blob(constant.blob)) });
    });
  }
}
