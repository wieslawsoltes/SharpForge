import { createTypeDesc } from './type-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

/** One module's lazily populated definition cache; nested ownership is indexed once in O(rows). */
export class MetadataTypeDefinitions {
  #module;
  #descriptors = new Map();
  #enclosing;
  constructor(module) { this.#module = module; }

  #index() {
    if (this.#enclosing) return this.#enclosing;
    const count = this.#module.rowCount(2);
    const nestedCount = this.#module.rowCount(41);
    if (count + nestedCount > 100000) throw loadError(LoadErrorCode.LimitExceeded, 'Type definition row limit exceeded');
    const enclosing = new Map();
    for (let index = 1; index <= nestedCount; index++) {
      const [nested, parent] = this.#module.row(0x29000000 + index);
      if (!nested || nested > count || !parent || parent > count || enclosing.has(nested)) {
        throw loadError(LoadErrorCode.TypeLoad, 'Invalid or duplicate nested type ownership');
      }
      enclosing.set(nested, parent);
    }
    this.#enclosing = enclosing;
    return enclosing;
  }

  /** Canonical TypeDef lookup; no reference resolution or method body decoding occurs. */
  get(token, path = new Set()) {
    if (!Number.isInteger(token) || token < 0 || token > 0xffffffff || token >>> 24 !== 2 || !(token & 0xffffff)) {
      throw loadError(LoadErrorCode.InvalidImage, 'Type definition requires a TypeDef token');
    }
    if (this.#descriptors.has(token)) return this.#descriptors.get(token);
    if (path.has(token)) throw loadError(LoadErrorCode.TypeLoad, 'Circular nested type ownership');
    if (path.size >= 128) throw loadError(LoadErrorCode.LimitExceeded, 'Nested type depth exceeded');
    const row = this.#module.row(token);
    const name = this.#module.string(row[1]);
    const namespace = this.#module.string(row[2]);
    const enclosing = this.#index().get(token & 0xffffff);
    const declaringType = enclosing ? this.get(0x02000000 + enclosing, new Set([...path, token])) : null;
    const fullName = declaringType ? `${declaringType.fullName}+${name}` : `${namespace ? namespace + '.' : ''}${name}`;
    if (fullName.length > 4096) throw loadError(LoadErrorCode.LimitExceeded, 'Type name length exceeded');
    const descriptor = createTypeDesc({ name, namespace: declaringType?.namespace ?? namespace, fullName,
      flags: row[0], module: this.#module, token, declaringType });
    this.#descriptors.set(token, descriptor);
    return descriptor;
  }
}
