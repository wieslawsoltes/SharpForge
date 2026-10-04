import { PortablePdbGenerations } from './pdb-generations.js';
import { pdbGenerationId } from './generation-identity.js';
import { generationError } from './pdb-delta-format.js';
import { sequencePointAt } from './sequence-points.js';

function bounded(value, maximum, name, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    generationError('PDB_REVISION_LIMIT', `Invalid PDB revision-map ${name} limit`);
  }
  return value;
}

function cancelled(signal) {
  if (signal?.aborted) generationError('PDB_REVISION_CANCELLED', 'PDB symbol snapshot capture cancelled');
}

class SymbolSnapshot {
  #reference;
  #record;
  #release;

  constructor(reference, record, release) {
    this.#reference = Object.freeze(reference);
    this.#record = record;
    this.#release = release;
  }
  get reference() { return this.#reference; }
  get disposed() { return this.#record === null; }
  #alive() {
    if (!this.#record) generationError('PDB_SYMBOL_SNAPSHOT_DISPOSED', 'PDB symbol snapshot has been disposed');
    return this.#record;
  }
  get points() { return this.#alive().points.map((point) => ({ ...point })); }

  /** Query the captured revision; the current runtime or symbol generation is never consulted. */
  location(offset) {
    const record = this.#alive();
    if (!Number.isInteger(offset) || offset < 0 || offset >= 0x20000000) {
      generationError('PDB_METHOD_OFFSET', 'Invalid PDB snapshot IL offset');
    }
    const point = sequencePointAt(record.points, offset);
    return point && !point.hidden ? { ...point, source: record.documents.get(point.document).name,
      generation: this.#reference.symbolGeneration, revision: this.#reference.revision } : null;
  }

  /** Return document identity/hash metadata without embedded source payloads. */
  getDocument(documentId) {
    const record = this.#alive().documents.get(documentId);
    if (!record) generationError('PDB_DOCUMENT_ID', 'Document is not referenced by this PDB symbol snapshot');
    return structuredClone(record);
  }

  /** Drop this snapshot's cache lease. Repeated disposal is harmless. */
  dispose() {
    if (!this.#record) return;
    this.#record = null;
    const release = this.#release;
    this.#release = null;
    release(this);
  }
}

/** Bind caller-owned frame generation/revision triples to bounded, immutable symbol snapshots. */
export class PortablePdbRevisionMap {
  #generations;
  #limits;
  #records = new Map();
  #snapshots = new Set();
  #pointCount = 0;
  #documentCount = 0;
  #disposed = false;

  constructor(generations, { maxSnapshots = 256, maxPoints = 1_000_000, maxDocuments = 10_000 } = {}) {
    if (!(generations instanceof PortablePdbGenerations)) {
      generationError('PDB_REVISION_SOURCE', 'PDB revision map requires PortablePdbGenerations');
    }
    this.#generations = generations;
    this.#limits = {
      snapshots: bounded(maxSnapshots, 10_000, 'snapshots', 1),
      points: bounded(maxPoints, 1_000_000, 'points'),
      documents: bounded(maxDocuments, 100_000, 'documents'),
    };
  }
  get disposed() { return this.#disposed; }

  #validate(reference) {
    if (this.#disposed) generationError('PDB_REVISION_MAP_DISPOSED', 'PDB revision map has been disposed');
    if (!reference || typeof reference !== 'object') generationError('PDB_METHOD_REVISION_MISMATCH', 'Invalid PDB snapshot reference');
    const baselineId = pdbGenerationId(reference.baselineId, 'baseline id');
    if (baselineId !== this.#generations.baselineId) generationError('PDB_BASELINE_MISMATCH', 'PDB snapshot belongs to a different baseline');
    if (!Number.isInteger(reference.generation) || reference.generation < 0) {
      generationError('PDB_GENERATION_MISMATCH', 'PDB snapshot requires an explicit generation ordinal');
    }
    const method = this.#generations.getMethodRevision(reference.methodToken, reference.generation);
    if (!method || !Number.isInteger(reference.revision) || method.revision !== reference.revision) {
      generationError('PDB_METHOD_REVISION_MISMATCH', 'PDB snapshot revision does not match its method generation');
    }
    return { baselineId, generation: reference.generation, symbolGeneration: method.generation,
      methodToken: reference.methodToken, revision: method.revision, pointCount: method.pointCount };
  }

  #record(reference) {
    const key = `${reference.methodToken}:${reference.symbolGeneration}:${reference.revision}`;
    const previous = this.#records.get(key);
    if (previous) return previous;
    if (this.#pointCount + reference.pointCount > this.#limits.points) {
      generationError('PDB_REVISION_BUDGET', 'PDB snapshot point budget exceeded');
    }
    const points = this.#generations.getSequencePoints(reference.methodToken, reference.symbolGeneration);
    const documentIds = new Set(points.map((point) => point.document));
    if (this.#documentCount + documentIds.size > this.#limits.documents) {
      generationError('PDB_REVISION_BUDGET', 'PDB snapshot document budget exceeded');
    }
    const documents = new Map();
    for (const id of documentIds) {
      documents.set(id, this.#generations.getDocument(id, reference.symbolGeneration, { includeSource: false }));
    }
    return { key, points, documents, leases: 0 };
  }

  /** Validate (baseline, generation, methodToken, revision), then atomically lease the exact symbol map. */
  capture(reference, { signal } = {}) {
    cancelled(signal);
    const checked = this.#validate(reference);
    if (this.#snapshots.size >= this.#limits.snapshots) generationError('PDB_REVISION_BUDGET', 'PDB snapshot count budget exceeded');
    const record = this.#record(checked);
    cancelled(signal);
    if (record.leases === 0) {
      this.#records.set(record.key, record);
      this.#pointCount += record.points.length;
      this.#documentCount += record.documents.size;
    }
    record.leases++;
    const { pointCount, ...identity } = checked;
    const snapshot = new SymbolSnapshot(identity, record, (value) => this.#release(value, record));
    this.#snapshots.add(snapshot);
    return snapshot;
  }

  #release(snapshot, record) {
    this.#snapshots.delete(snapshot);
    if (--record.leases !== 0) return;
    this.#records.delete(record.key);
    this.#pointCount -= record.points.length;
    this.#documentCount -= record.documents.size;
  }

  /** Dispose all active snapshots and release the generation provider. */
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const snapshot of this.#snapshots) snapshot.dispose();
    this.#generations = null;
  }
}
