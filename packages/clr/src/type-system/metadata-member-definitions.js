import { createMethodDesc } from './method-desc.js';
import { createFieldDesc } from './field-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

const empty = Object.freeze([]);
const kinds = Object.freeze({
  method: { table: 6, pointer: 5, list: 'MethodList', name: 3, create: createMethodDesc,
    details: row => ({ flags: row[2], implementationFlags: row[1], signatureIndex: row[4] }) },
  field: { table: 4, pointer: 3, list: 'FieldList', name: 1, create: createFieldDesc,
    nameOptions: Object.freeze({ maxBytes: 4096 }), details: row => ({ flags: row[0], signatureIndex: row[2] }) },
});

/** One module's bounded definition ownership index; schemas share MethodList/FieldList traversal and caches. */
export class MetadataMemberDefinitions {
  #module;
  #kind;
  #owners;
  #tokens;
  #descriptors = new Map();
  #lists = new Map();
  constructor(module, kind = 'method') {
    if (!Object.hasOwn(kinds, kind)) throw new TypeError('Unknown metadata member kind');
    this.#module = module;
    this.#kind = kinds[kind];
  }

  #index() {
    if (this.#owners) return;
    const typeCount = this.#module.rowCount(2);
    const memberCount = this.#module.rowCount(this.#kind.table);
    if (typeCount + memberCount + this.#module.rowCount(this.#kind.pointer) > 100000) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Member definition row limit exceeded');
    }
    const owners = new Uint32Array(memberCount + 1);
    const lists = new Map();
    for (let rid = 1; rid <= typeCount; rid++) {
      const typeToken = 0x02000000 + rid;
      const tokens = this.#module.list(typeToken, this.#kind.list);
      for (const token of tokens) {
        const member = token & 0xffffff;
        if (token >>> 24 !== this.#kind.table || !member || member > memberCount || owners[member]) {
          throw loadError(LoadErrorCode.InvalidImage, 'Invalid or duplicate member ownership');
        }
        owners[member] = typeToken;
      }
      if (tokens.length) lists.set(typeToken, tokens);
    }
    for (let rid = 1; rid <= memberCount; rid++) {
      if (!owners[rid]) throw loadError(LoadErrorCode.InvalidImage, 'Member definition has no declaring type');
    }
    this.#tokens = lists;
    this.#owners = owners;
  }

  #read(operation) {
    try { return operation(); }
    catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw loadError(LoadErrorCode.InvalidImage, `Invalid member metadata: ${error.message}`);
    }
  }

  /** Preserve definition-list order, including #- pointer indirection; inherited members are not enumerated. */
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
      if (!Number.isInteger(token) || token < 0 || token > 0xffffffff || token >>> 24 !== this.#kind.table || !(token & 0xffffff)) {
        throw loadError(LoadErrorCode.InvalidImage, 'Member definition token does not match its metadata kind');
      }
      const row = this.#module.row(token);
      this.#index();
      const name = this.#module.string(row[this.#kind.name], this.#kind.nameOptions);
      if (name.length > 4096) throw loadError(LoadErrorCode.LimitExceeded, 'Member name length exceeded');
      const descriptor = this.#kind.create({ name, module: this.#module, token, ...this.#kind.details(row),
        declaringType: this.#module.typeDefinition(this.#owners[token & 0xffffff]) });
      this.#descriptors.set(token, descriptor);
      return descriptor;
    });
  }
}
