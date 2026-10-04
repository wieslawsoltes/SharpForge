import { CilError } from '../binary.js';
import { AssemblyInspector } from '../inspector.js';
import { metadataTokenUri } from './navigation.js';

const maximum = Object.freeze({ assemblies: 256, entries: 100000, nameBytes: 16 * 1024 * 1024, bytes: 32 * 1024 * 1024 });
const members = Object.freeze([['fields', 'field', 4], ['methods', 'method', 6], ['properties', 'property', 23], ['events', 'event', 20]]);
const uriLength = 61;

function cancelled(signal) {
  if (signal?.aborted) throw new CilError('Assembly symbol indexing cancelled');
}

function integer(value, limit, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit) throw new CilError(`Invalid assembly index ${label}`);
  return value;
}

function limits(options) {
  const result = {};
  for (const key of Object.keys(maximum)) result[key] = integer(options[key] ?? maximum[key], maximum[key], `${key} budget`);
  return result;
}

function rowCount(inspector) {
  const rows = inspector.metadata.rows;
  return [2, 4, 6, 20, 23].reduce((count, table) => count + (rows[table]?.length ?? 0), 0);
}

function preflightCounts(assemblies, budget, signal) {
  if (!Array.isArray(assemblies) || assemblies.length > budget.assemblies) throw new CilError('Assembly index assembly limit exceeded');
  let entries = 0;
  for (const inspector of assemblies) {
    cancelled(signal);
    if (!(inspector instanceof AssemblyInspector)) throw new CilError('Assembly index requires loaded AssemblyInspectors');
    entries += rowCount(inspector);
    if (entries > budget.entries) throw new CilError('Assembly index entry limit exceeded');
  }
  return entries;
}

function visit(inspector, visitor, signal) {
  let count = 0;
  const expected = rowCount(inspector);
  if (!Array.isArray(inspector.types) || inspector.types.length > expected) throw new CilError('Invalid assembly index types');
  for (const type of inspector.types) {
    cancelled(signal);
    if (++count > expected) throw new CilError('Invalid assembly index definition count');
    visitor(type, 'type', 2, null);
    for (const [key, kind, table] of members) {
      if (!Array.isArray(type[key]) || type[key].length > expected - count) throw new CilError('Invalid assembly index members');
      for (const member of type[key]) {
        if (!(count++ & 255)) cancelled(signal);
        visitor(member, kind, table, type.token);
      }
    }
  }
  if (count !== expected) throw new CilError('Incomplete assembly index ownership');
}

function checkedDefinition(inspector, definition, table) {
  if (!definition || typeof definition !== 'object') throw new CilError('Invalid assembly index definition');
  const token = definition.token;
  if (!Number.isInteger(token) || token < 1 || token > 0xffffffff || token >>> 24 !== table || !(token & 0xffffff))
    throw new CilError('Invalid assembly index definition token');
  inspector.metadata.row(token);
  if (typeof definition.name !== 'string' || definition.name.length > 4096) throw new CilError('Invalid assembly index definition name');
}

function charge(usage, budget, definition, kind, owner) {
  usage.nameBytes += 2 * definition.name.length;
  // Logical UTF-16 string payloads plus the 32-bit token. Repeated owner IDs are charged each time.
  usage.bytes += 2 * (definition.name.length + kind.length + uriLength + (owner === null ? 0 : uriLength)) + 4;
  if (usage.nameBytes > budget.nameBytes || usage.bytes > budget.bytes) throw new CilError('Assembly index storage limit exceeded');
}

/** An owned definition index over loaded modules; construction never decodes method bodies. */
export class AssemblySymbolIndex {
  #entries = [];
  #byId = new Map();
  #modules = [];
  #usage;

  /** Lowerable count/string-payload budgets exclude pre-existing inspectors and engine object overhead. */
  constructor(assemblies, { signal, ...options } = {}) {
    cancelled(signal);
    const budget = limits(options);
    const entries = preflightCounts(assemblies, budget, signal);
    const usage = { assemblies: assemblies.length, entries, nameBytes: 0, bytes: assemblies.length * (36 * 2 + 4) };
    if (usage.bytes > budget.bytes) throw new CilError('Assembly index storage limit exceeded');
    // Complete the aggregate name/payload preflight before creating any retained symbol records.
    for (const inspector of assemblies) visit(inspector, (definition, kind, table, owner) => {
      checkedDefinition(inspector, definition, table);
      charge(usage, budget, definition, kind, owner);
    }, signal);
    const moduleIds = new Set();
    for (const inspector of assemblies) {
      const uri = metadataTokenUri(inspector.metadata, 1);
      const prefix = uri.slice(0, -10);
      const mvid = prefix.slice('sf-metadata://'.length, -1);
      if (moduleIds.has(mvid)) throw new CilError('Duplicate module MVID in assembly index');
      moduleIds.add(mvid);
      this.#modules.push({ mvid, entries: rowCount(inspector) });
      visit(inspector, (definition, kind, table, owner) => {
        const id = prefix + '0x' + definition.token.toString(16).padStart(8, '0');
        if (this.#byId.has(id)) throw new CilError('Duplicate definition ownership in assembly index');
        const declaringTypeId = owner === null ? null : prefix + '0x' + owner.toString(16).padStart(8, '0');
        const record = { id, token: definition.token, kind, name: definition.name, declaringTypeId };
        this.#entries.push(record);
        this.#byId.set(id, record);
      }, signal);
    }
    cancelled(signal);
    this.#usage = usage;
  }

  /** Number of indexed TypeDef, Field, MethodDef, Property and Event definitions. */
  get size() { return this.#entries.length; }

  /** Owned deterministic counters; bytes is a logical payload measure, not JavaScript heap usage. */
  get storage() { return { ...this.#usage }; }

  /** Owned module identities in input order; same-MVID duplicates are rejected during construction. */
  modules() { return this.#modules.map(module => ({ ...module })); }

  /** Look up an exact stable ID; unknown or noncanonical IDs return null without metadata access. */
  get(id) {
    if (typeof id !== 'string' || id.length > uriLength) throw new CilError('Invalid assembly index ID');
    const entry = this.#byId.get(id);
    return entry ? { ...entry } : null;
  }

  /** An owned page in input-module/type/member order, with a hard maximum of 1,000 records. */
  page({ offset = 0, limit = 100, signal } = {}) {
    cancelled(signal);
    integer(offset, this.size, 'offset');
    integer(limit, 1000, 'page limit');
    const end = Math.min(offset + limit, this.size);
    const entries = [];
    for (let index = offset; index < end; index++) {
      if (!(index & 255)) cancelled(signal);
      entries.push({ ...this.#entries[index] });
    }
    return { entries, total: this.size, nextOffset: end < this.size ? end : null };
  }
}
