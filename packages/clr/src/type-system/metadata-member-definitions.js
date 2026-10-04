import { createMethodDesc } from './method-desc.js';
import { createFieldDesc } from './field-desc.js';
import { createPropertyDesc } from './property-desc.js';
import { createEventDesc, initializeEventType } from './event-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

const empty = Object.freeze([]);
const kinds = Object.freeze({
  method: { table: 6, pointer: 5, list: 'MethodList', name: 3, flags: 2, implementationFlags: 1, signature: 4, create: createMethodDesc,
    nameOptions: Object.freeze({ maxBytes: 16 * 1024 }) },
  field: { table: 4, pointer: 3, list: 'FieldList', name: 1, flags: 0, signature: 2, create: createFieldDesc,
    nameOptions: Object.freeze({ maxBytes: 4096 }) },
  property: { table: 23, pointer: 22, map: 21, list: 'PropertyList', name: 1, flags: 0, signature: 2, create: createPropertyDesc,
    nameOptions: Object.freeze({ maxBytes: 4096 }) },
  event: { table: 20, pointer: 19, map: 18, list: 'EventList', name: 1, flags: 0, create: createEventDesc,
    nameOptions: Object.freeze({ maxBytes: 4096 }), initialize: initializeEventType },
});

/** Module-owned definition caches with direct TypeDef lists or indirect PropertyMap/EventMap lists. */
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
    const mapCount = this.#kind.map ? this.#module.rowCount(this.#kind.map) : 0;
    if (typeCount + memberCount + mapCount + this.#module.rowCount(this.#kind.pointer) > 100000) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Member definition row limit exceeded');
    }
    const owners = new Uint32Array(memberCount + 1);
    const lists = new Map();
    const mappedOwners = this.#kind.map ? new Set() : null;
    const mappedStarts = this.#kind.map ? new Set() : null;
    for (let rid = 1; rid <= (this.#kind.map ? mapCount : typeCount); rid++) {
      const listToken = (this.#kind.map ?? 2) * 0x1000000 + rid;
      const map = this.#kind.map ? this.#module.row(listToken) : null;
      const typeRid = map ? map[0] : rid;
      if (!typeRid || typeRid > typeCount || mappedOwners?.has(typeRid) || mappedStarts?.has(map[1])) {
        throw loadError(LoadErrorCode.InvalidImage, 'Invalid or duplicate member map owner');
      }
      mappedOwners?.add(typeRid);
      mappedStarts?.add(map[1]);
      const typeToken = 0x02000000 + typeRid;
      const tokens = this.#module.list(listToken, this.#kind.list);
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
    const descriptor = this.#descriptors.get(token);
    if (descriptor) return descriptor;
    return this.#read(() => this.#create(token));
  }

  #create(token) {
    if (!Number.isInteger(token) || token < 0 || token > 0xffffffff || token >>> 24 !== this.#kind.table || !(token & 0xffffff)) {
      throw loadError(LoadErrorCode.InvalidImage, 'Member definition token does not match its metadata kind');
    }
    const row = this.#module.row(token);
    this.#index();
    const name = this.#module.string(row[this.#kind.name], this.#kind.nameOptions);
    if (name.length > 4096) throw loadError(LoadErrorCode.LimitExceeded, 'Member name length exceeded');
    const state = { name, module: this.#module, token, flags: row[this.#kind.flags],
      implementationFlags: row[this.#kind.implementationFlags], signatureIndex: row[this.#kind.signature],
      declaringType: this.#module.typeDefinition(this.#owners[token & 0xffffff]) };
    this.#kind.initialize?.(state, row);
    const descriptor = this.#kind.create(state);
    this.#descriptors.set(token, descriptor);
    return descriptor;
  }
}
