import { createMethodDesc } from './method-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

const empty = Object.freeze([]);

/** One module's bounded ownership index and lazily populated MethodDef identity cache. */
export class MetadataMethodDefinitions {
  #module;
  #owners;
  #tokens;
  #descriptors = new Map();
  #lists = new Map();
  constructor(module) { this.#module = module; }

  #index() {
    if (this.#owners) return;
    const typeCount = this.#module.rowCount(2);
    const methodCount = this.#module.rowCount(6);
    if (typeCount + methodCount + this.#module.rowCount(5) > 100000) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Method definition row limit exceeded');
    }
    const owners = new Uint32Array(methodCount + 1);
    const lists = new Map();
    for (let rid = 1; rid <= typeCount; rid++) {
      const typeToken = 0x02000000 + rid;
      const tokens = this.#module.list(typeToken, 'MethodList');
      for (const token of tokens) {
        const method = token & 0xffffff;
        if (token >>> 24 !== 6 || !method || method > methodCount || owners[method]) {
          throw loadError(LoadErrorCode.InvalidImage, 'Invalid or duplicate method ownership');
        }
        owners[method] = typeToken;
      }
      if (tokens.length) lists.set(typeToken, tokens);
    }
    for (let rid = 1; rid <= methodCount; rid++) {
      if (!owners[rid]) throw loadError(LoadErrorCode.InvalidImage, 'Method definition has no declaring type');
    }
    this.#tokens = lists;
    this.#owners = owners;
  }

  #read(operation) {
    try { return operation(); }
    catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw loadError(LoadErrorCode.InvalidImage, `Invalid method metadata: ${error.message}`);
    }
  }

  /** Preserve MethodList order, including #- MethodPtr indirection; inherited methods are not enumerated. */
  forType(typeToken) {
    if (this.#lists.has(typeToken)) return this.#lists.get(typeToken);
    return this.#read(() => {
      this.#module.typeDefinition(typeToken);
      this.#index();
      const tokens = this.#tokens.get(typeToken);
      if (!tokens) return empty;
      if (!this.#lists.has(typeToken)) this.#lists.set(typeToken, Object.freeze(tokens.map(token => this.get(token))));
      return this.#lists.get(typeToken);
    });
  }

  /** No signature blob or executable body is read during identity lookup. */
  get(token) {
    if (this.#descriptors.has(token)) return this.#descriptors.get(token);
    return this.#read(() => {
      if (!Number.isInteger(token) || token < 0 || token > 0xffffffff || token >>> 24 !== 6 || !(token & 0xffffff)) {
        throw loadError(LoadErrorCode.InvalidImage, 'Method definition requires a MethodDef token');
      }
      const row = this.#module.row(token);
      this.#index();
      const name = this.#module.string(row[3]);
      if (name.length > 4096) throw loadError(LoadErrorCode.LimitExceeded, 'Method name length exceeded');
      const descriptor = createMethodDesc({ name, flags: row[2], implementationFlags: row[1], module: this.#module,
        token, declaringType: this.#module.typeDefinition(this.#owners[token & 0xffffff]), signatureIndex: row[4] });
      this.#descriptors.set(token, descriptor);
      return descriptor;
    });
  }
}
