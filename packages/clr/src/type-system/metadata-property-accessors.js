import { decodeCoded } from '@sharpforge/cil';
import { loadError, LoadErrorCode } from '../load-errors.js';

const invalid = message => loadError(LoadErrorCode.InvalidImage, message);
const propertyRoles = new Set([1, 2, 4]);

/** Module-local Property MethodSemantics index; no method signatures or bodies are read. */
export class MetadataPropertyAccessors {
  #module;
  #rows;
  #values = new Map();
  constructor(module) { this.#module = module; }

  #index() {
    if (this.#rows) return;
    const count = this.#module.rowCount(24);
    const propertyCount = this.#module.rowCount(23);
    const methodCount = this.#module.rowCount(6);
    if (count + propertyCount > 100000) throw loadError(LoadErrorCode.LimitExceeded, 'Property accessor row limit exceeded');
    const rows = new Map();
    for (let rid = 1; rid <= count; rid++) {
      const [semantics, method, association] = this.#module.row(0x18000000 + rid);
      const token = decodeCoded('HasSemantics', association);
      if (!token) throw invalid('Missing MethodSemantics association');
      if (token >>> 24 !== 23) continue;
      if (!(token & 0xffffff) || (token & 0xffffff) > propertyCount || !propertyRoles.has(semantics)) {
        throw invalid('Invalid property MethodSemantics association or role');
      }
      if (!method || method > methodCount) throw invalid('Invalid property accessor method');
      if (!rows.has(token)) rows.set(token, []);
      rows.get(token).push({ semantics, method: 0x06000000 + method });
    }
    this.#rows = rows;
  }

  /** Frozen getter/setter (or null) and ordered other-method array; owner mismatches and duplicate roles are rejected. */
  get(token) {
    if (this.#values.has(token)) return this.#values.get(token);
    try {
      const property = this.#module.propertyDefinition(token);
      this.#index();
      let getMethod = null, setMethod = null;
      const otherMethods = [];
      const seen = new Set();
      for (const row of this.#rows.get(token) ?? []) {
        const method = this.#module.methodDefinition(row.method);
        if (method.declaringType !== property.declaringType || seen.has(row.method)) {
          throw invalid('Property accessor has a different owner or repeated method');
        }
        seen.add(row.method);
        if (row.semantics === 2) {
          if (getMethod) throw invalid('Duplicate property getter');
          getMethod = method;
        } else if (row.semantics === 1) {
          if (setMethod) throw invalid('Duplicate property setter');
          setMethod = method;
        } else otherMethods.push(method);
      }
      const value = Object.freeze({ getMethod, setMethod, otherMethods: Object.freeze(otherMethods) });
      this.#values.set(token, value);
      return value;
    } catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw invalid(`Invalid property accessors: ${error.message}`);
    }
  }
}
