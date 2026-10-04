import { Reader } from '@sharpforge/cil';
import { PdbGuids, fail, guidBytes } from './contracts.js';

export const defaultParseBudgets = Object.freeze({
  documents: 100000,
  methods: 100000,
  scopes: 100000,
  imports: 100000,
  customRecords: 100000,
  cdiBytes: 64 * 1024 * 1024,
  embeddedSourceBytes: 64 * 1024 * 1024,
});
const embeddedSourceKind = guidBytes(PdbGuids.embeddedSource);

function embeddedSource(guids, index) {
  const start = (index - 1) * 16;
  if (!guids || start < 0 || start + 16 > guids.length) return false;
  for (let byte = 0; byte < 16; byte++) if (guids[start + byte] !== embeddedSourceKind[byte]) return false;
  return true;
}

/** One parse owns validated scalar limits and counters; caller options and metadata are never retained. */
export class SymbolParseBudget {
  constructor(overrides = {}, signal) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) fail('Invalid symbol parse budgets');
    const limits = { ...defaultParseBudgets };
    for (const [name, value] of Object.entries(overrides)) {
      if (
        !Object.hasOwn(defaultParseBudgets, name) ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > defaultParseBudgets[name]
      ) {
        fail(`Invalid symbol parse budget ${name}`);
      }
      limits[name] = value;
    }
    this.limits = Object.freeze(limits);
    this.signal = signal;
    this.check();
  }
  check() {
    if (this.signal?.aborted) fail('Portable PDB parsing cancelled');
  }
  require(name, count) {
    if (count > this.limits[name]) fail(`Portable PDB ${name} budget exceeded`);
  }
  rows(metadata) {
    this.check();
    for (const [name, table] of [
      ['documents', 48],
      ['methods', 49],
      ['scopes', 50],
      ['imports', 53],
      ['customRecords', 55],
    ]) {
      this.require(name, metadata.counts[table] ?? 0);
    }
    this.require('methods', metadata.externalCounts[6] ?? 0);
  }
  custom(metadata, maxSourceBytes) {
    if (!Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 0) fail('Invalid embedded source byte limit');
    const guids = metadata.streams.get('#GUID'),
      rows = metadata.rows[55] ?? [];
    let bytes = 0,
      sources = 0;
    // Charge each row occurrence, even when payload handles or document parents are shared.
    for (let index = 0; index < rows.length; index++) {
      if ((index & 255) === 0) this.check();
      const row = rows[index],
        payload = metadata.blob(row[2]);
      this.require('cdiBytes', (bytes += payload.length));
      if (!embeddedSource(guids, row[1])) continue;
      const declared = new Reader(payload).i32(),
        encoded = payload.length - 4;
      if (declared < 0 || declared > maxSourceBytes || encoded > maxSourceBytes) fail('Invalid embedded source size');
      this.require('embeddedSourceBytes', (sources += declared || encoded));
    }
  }
  imports() {
    return { entries: 0, bytes: 0, maxEntries: this.limits.imports, check: () => this.check() };
  }
}
