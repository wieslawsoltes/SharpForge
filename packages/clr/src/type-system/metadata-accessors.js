import { decodeCoded } from '@sharpforge/cil';
import { loadError, LoadErrorCode } from '../load-errors.js';

const invalid = message => loadError(LoadErrorCode.InvalidImage, message);
const kinds = new Map([
  [23, { member: 'propertyDefinition', roles: { 1: 'setMethod', 2: 'getMethod', 4: 'otherMethods' }, required: [],
    create: () => ({ getMethod: null, setMethod: null, otherMethods: [] }) }],
  [20, { member: 'eventDefinition', roles: { 8: 'addMethod', 16: 'removeMethod', 32: 'raiseMethod', 4: 'otherMethods' },
    required: ['addMethod', 'removeMethod'], create: () => ({ addMethod: null, removeMethod: null, raiseMethod: null, otherMethods: [] }) }],
]);

/** Module-owned MethodSemantics rows shared by Property and Event, validated lazily per owner kind. */
export class MetadataAccessors {
  #module;
  #tables;
  #validated = new Set();
  #values = new Map();
  constructor(module) { this.#module = module; }

  #index(table, kind) {
    if (this.#validated.has(table)) return this.#tables.get(table);
    const count = this.#module.rowCount(24);
    const memberCount = this.#module.rowCount(table);
    if (count + memberCount > 100000) throw loadError(LoadErrorCode.LimitExceeded, 'Accessor row limit exceeded');
    if (!this.#tables) {
      const tables = new Map();
      for (let rid = 1; rid <= count; rid++) {
        const [semantics, method, association] = this.#module.row(0x18000000 + rid);
        const token = decodeCoded('HasSemantics', association);
        if (!token) throw invalid('Missing MethodSemantics association');
        const owner = token >>> 24;
        if (!tables.has(owner)) tables.set(owner, new Map());
        const rows = tables.get(owner);
        if (!rows.has(token)) rows.set(token, []);
        rows.get(token).push({ semantics, method });
      }
      this.#tables = tables;
    }
    const rows = this.#tables.get(table);
    if (!this.#validated.has(table)) {
      const methodCount = this.#module.rowCount(6);
      for (const [token, entries] of rows ?? []) {
        if (!(token & 0xffffff) || (token & 0xffffff) > memberCount) throw invalid('Invalid MethodSemantics association');
        for (const entry of entries) {
          const method = entry.method;
          if (!Object.hasOwn(kind.roles, entry.semantics) || !method || method > methodCount) {
            throw invalid('Invalid accessor role or method');
          }
        }
      }
      this.#validated.add(table);
    }
    return rows;
  }

  /** Frozen canonical links; duplicate roles/methods, owner mismatches and missing Event add/remove roles are rejected. */
  get(token, table = 23) {
    try {
      const kind = kinds.get(table);
      if (!kind || token >>> 24 !== table) throw invalid('Accessor token does not match its metadata kind');
      if (this.#values.has(token)) return this.#values.get(token);
      const member = this.#module[kind.member](token);
      const rows = this.#index(table, kind);
      const value = kind.create();
      const seen = new Set();
      for (const row of rows?.get(token) ?? []) {
        const method = this.#module.methodDefinition(0x06000000 + row.method);
        if (method.declaringType !== member.declaringType || seen.has(row.method)) {
          throw invalid('Accessor has a different owner or repeated method');
        }
        seen.add(row.method);
        const role = kind.roles[row.semantics];
        if (role === 'otherMethods') value.otherMethods.push(method);
        else {
          if (value[role]) throw invalid('Duplicate accessor role');
          value[role] = method;
        }
      }
      for (const role of kind.required) {
        if (!value[role]) throw invalid('Event requires add and remove accessors');
      }
      Object.freeze(value.otherMethods);
      Object.freeze(value);
      this.#values.set(token, value);
      return value;
    } catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw invalid(`Invalid accessors: ${error.message}`);
    }
  }
}
