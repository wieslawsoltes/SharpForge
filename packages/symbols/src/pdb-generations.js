import { readPortablePdb } from './pdb-reader.js';
import { readPortablePdbDelta } from './pdb-delta-reader.js';
import { generationError, generationRowCounts } from './pdb-delta-format.js';
import { pdbGenerationId as identity } from './generation-identity.js';

function limit(value, fallback, maximum, name) {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    generationError('PDB_GENERATION_LIMIT', `Invalid PDB generation ${name} limit`);
  }
  return value;
}

function group(records, key) {
  const result = new Map();
  for (const record of records) {
    const id = record[key];
    if (!result.has(id)) result.set(id, []);
    result.get(id).push(record);
  }
  return result;
}

/** An owned, bounded baseline/delta history. Generation zero is baseline; reader version is generation + 1. */
export class PortablePdbGenerations {
  #entries = [];
  #methods = new Map();
  #readerOptions;
  #limits;
  #bytes = 0;
  #records = 0;
  #disposed = false;
  #baselineId;

  constructor(baselineBytes, options = {}) {
    this.#limits = {
      generations: limit(options.maxGenerations, 64, 1024, 'count'),
      bytes: limit(options.maxRetainedBytes, 128 * 1024 * 1024, 1024 * 1024 * 1024, 'bytes'),
      records: limit(options.maxRetainedRecords, 500_000, 1_000_000, 'records'),
    };
    const reader = options.readerOptions ?? {};
    this.#readerOptions = { ...reader, ...(reader.budgets ? { budgets: { ...reader.budgets } } : {}) };
    this.#checkBytes(baselineBytes);
    const pdb = readPortablePdb(baselineBytes, this.#readerOptions);
    this.#baselineId = pdb.idHex;
    this.#commit(pdb, generationRowCounts(pdb.metadata.externalCounts));
  }

  get baselineId() { return this.#baselineId; }
  get disposed() { return this.#disposed; }
  get generation() { this.#alive(); return this.#entries.length - 1; }
  get pdbId() { return this.#entry(this.generation).pdb.idHex; }

  #alive() {
    if (this.#disposed) generationError('PDB_GENERATIONS_DISPOSED', 'PDB generations have been disposed');
  }

  #checkBytes(bytes) {
    const length = bytes instanceof Uint8Array ? bytes.length : bytes instanceof ArrayBuffer ? bytes.byteLength : -1;
    if (length < 0) generationError('PDB_DELTA_FORMAT', 'PDB generation requires binary bytes');
    if (this.#bytes + length > this.#limits.bytes) {
      generationError('PDB_GENERATION_BUDGET', 'PDB generation retained-byte limit exceeded');
    }
  }

  #entry(generation) {
    this.#alive();
    if (!Number.isInteger(generation) || generation < 0 || generation >= this.#entries.length) {
      generationError('PDB_GENERATION_MISMATCH', 'PDB generation is unavailable');
    }
    return this.#entries[generation];
  }

  #commit(pdb, counts) {
    const records = Object.values(pdb.metadata.rows).reduce((sum, rows) => sum + rows.length, 0);
    if (this.#records + records > this.#limits.records) {
      generationError('PDB_GENERATION_BUDGET', 'PDB generation retained-record limit exceeded');
    }
    const generation = this.#entries.length;
    const scopes = group(pdb.scopes, 'methodToken');
    const custom = group(pdb.custom.filter((record) => record.parent >>> 24 === 6), 'parent');
    const entry = { pdb, counts, generation };
    for (const method of pdb.methods) {
      let revisions = this.#methods.get(method.token);
      if (!revisions) this.#methods.set(method.token, revisions = []);
      revisions.push({
        entry, revision: revisions.length + 1,
        data: { ...method, scopes: scopes.get(method.token) ?? [], custom: custom.get(method.token) ?? [] },
      });
    }
    this.#entries.push(entry);
    this.#bytes += pdb.bytes.length;
    this.#records += records;
  }

  /** Append atomically after validating the caller's baseline/previous-PDB envelope and aggregate CLI counts. */
  append(deltaBytes, { baselineId, previousPdbId, generation, typeSystemRowCounts, pdbId, signal } = {}) {
    const previous = this.#entry(this.generation);
    if (identity(baselineId, 'baseline id') !== this.#baselineId) {
      generationError('PDB_BASELINE_MISMATCH', 'PDB delta belongs to a different baseline');
    }
    if (identity(previousPdbId, 'previous id') !== previous.pdb.idHex) {
      generationError('PDB_PREVIOUS_GENERATION_MISMATCH', 'PDB delta does not follow the current PDB generation');
    }
    if (!Number.isInteger(generation) || generation !== previous.generation + 1) {
      generationError('PDB_GENERATION_MISMATCH', 'PDB delta generation must immediately follow the current generation');
    }
    if (this.#entries.length >= this.#limits.generations) {
      generationError('PDB_GENERATION_BUDGET', 'PDB generation count limit exceeded');
    }
    this.#checkBytes(deltaBytes);
    const counts = generationRowCounts(typeSystemRowCounts);
    for (const [table, count] of Object.entries(previous.counts)) {
      if (count > (counts[table] ?? 0)) generationError('PDB_DELTA_COUNTS', 'PDB aggregate row counts cannot decrease');
    }
    const pdb = readPortablePdbDelta(deltaBytes, {
      ...this.#readerOptions, ...(signal ? { signal } : {}), typeSystemRowCounts: counts,
    });
    if (pdbId !== undefined && identity(pdbId, 'id') !== pdb.idHex) {
      generationError('PDB_GENERATION_ID', 'PDB delta content id does not match its envelope');
    }
    const changed = new Set(pdb.methods.map((method) => method.token & 0xffffff));
    for (let row = (previous.counts[6] ?? 0) + 1; row <= (counts[6] ?? 0); row++) {
      if (!changed.has(row)) generationError('PDB_DELTA_MAP', 'PDB delta omits a newly added method');
    }
    this.#commit(pdb, counts);
    return Object.freeze({ baselineId: this.#baselineId, previousPdbId, generation, pdbId: pdb.idHex });
  }

  #method(methodToken, generation) {
    const entry = this.#entry(generation);
    if (!Number.isInteger(methodToken) || methodToken < 0x06000001 || methodToken > 0x06000000 + (entry.counts[6] ?? 0)) {
      generationError('PDB_METHOD_TOKEN', 'Invalid PDB generation method token');
    }
    const revisions = this.#methods.get(methodToken) ?? [];
    let low = 0;
    let high = revisions.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (revisions[middle].entry.generation <= generation) low = middle + 1;
      else high = middle;
    }
    return revisions[low - 1] ?? null;
  }

  /** Return owned debug records from the latest method update at or before the requested generation. */
  getMethod(methodToken, generation = this.generation) {
    const method = this.#method(methodToken, generation);
    if (!method) return null;
    return {
      ...structuredClone(method.data), generation: method.entry.generation,
      version: method.entry.generation + 1, revision: method.revision,
    };
  }

  /** Reader version one is baseline, version two is generation one. Unchanged methods retain prior records. */
  getMethodByVersion(methodToken, version) {
    if (!Number.isInteger(version) || version < 1) generationError('PDB_GENERATION_MISMATCH', 'Invalid PDB reader version');
    return this.getMethod(methodToken, version - 1);
  }

  /** Resolve a byte offset without copying the entire method; hidden points return null. */
  location(methodToken, offset, generation = this.generation) {
    if (!Number.isInteger(offset) || offset < 0 || offset >= 0x20000000) {
      generationError('PDB_METHOD_OFFSET', 'Invalid PDB generation IL offset');
    }
    const method = this.#method(methodToken, generation);
    if (!method) return null;
    const point = method.entry.pdb.location(methodToken, offset);
    return point ? { ...point, generation: method.entry.generation, revision: method.revision } : null;
  }

  /** Document ids are local to a symbol generation; returned hashes and embedded source are independent copies. */
  getDocument(documentId, generation) {
    const documents = this.#entry(generation).pdb.documents;
    if (!Number.isInteger(documentId) || documentId < 1 || documentId > documents.length) {
      generationError('PDB_DOCUMENT_ID', 'Invalid PDB generation document id');
    }
    return structuredClone(documents[documentId - 1]);
  }

  /** Release retained generations. Repeated disposal is harmless; subsequent queries and appends fail explicitly. */
  dispose() {
    this.#disposed = true;
    this.#entries.length = 0;
    this.#methods.clear();
    this.#readerOptions = null;
    this.#bytes = 0;
    this.#records = 0;
  }
}
