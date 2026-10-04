import { CilError } from '@sharpforge/cil';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const maxima = Object.freeze({ maxMetadataRows: 100000, maxMethods: 16384, maxRelations: 100000,
  maxDiagnostics: 16384, maxDepth: 128, maxMetadataBytes: 8 * 1024 * 1024, maxWork: 1000000 });
const tables = [0, 1, 2, 5, 6, 9, 10, 25, 27, 35, 41, 42, 44];

export const unsupportedRelation = reason => loadError(LoadErrorCode.TypeLoad, reason);
export const invalidRelation = reason => loadError(LoadErrorCode.InvalidImage, reason);

/** Explicit per-operation work/storage ceilings, including each metadata heap occurrence. */
export class UsageRelationBudget {
  #modules = new WeakSet();
  #rows = 0;
  #methods = 0;
  #bytes = 0;
  #work = 0;
  constructor(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw loadError(LoadErrorCode.InvalidConfiguration, 'Invalid declaration relation options');
    }
    this.signal = options.signal;
    for (const [name, maximum] of Object.entries(maxima)) {
      const value = options[name] ?? maximum;
      if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
        throw loadError(LoadErrorCode.InvalidConfiguration, `Invalid declaration relation ${name}`);
      }
      this[name] = value;
    }
    this.check();
  }

  check() { checkCancellation(this.signal); }

  work() {
    this.check();
    if (++this.#work > this.maxWork) this.exceeded('work');
  }

  exceeded(kind) { throw loadError(LoadErrorCode.LimitExceeded, `Declaration relation ${kind} limit exceeded`); }

  depth(value) {
    this.work();
    if (value > this.maxDepth) this.exceeded('hierarchy depth');
  }

  include(module) {
    this.check();
    if (this.#modules.has(module)) return;
    for (const table of tables) this.#rows += module.rowCount(table);
    this.#methods += module.rowCount(6);
    if (this.#rows > this.maxMetadataRows || this.#methods > this.maxMethods) this.exceeded('metadata rows/methods');
    for (const table of [1, 2, 6, 10]) this.#heap(module, table);
    this.#modules.add(module);
  }

  #heap(module, table) {
    for (let rid = 1; rid <= module.rowCount(table); rid++) {
      this.work();
      const row = module.row(table * 0x1000000 + rid);
      const names = table === 6 ? [row[3]] : table === 10 ? [row[1]] : [row[1], row[2]];
      for (const index of names) this.#bytes += 2 * module.string(index, { maxBytes: 4096 }).length;
      if (table === 6 || table === 10) this.#bytes += this.#signatureBytes(module, row[table === 6 ? 4 : 2]);
      if (this.#bytes > this.maxMetadataBytes) this.exceeded('metadata bytes');
    }
  }

  #signatureBytes(module, index) {
    try { return module.blob(index, { maxBytes: 4096 }).length; }
    catch (error) {
      if (error instanceof CilError) throw invalidRelation(`Invalid declaration signature heap: ${error.message}`);
      throw error;
    }
  }

  get storage() { return { metadataRows: this.#rows, methods: this.#methods, metadataBytes: this.#bytes, work: this.#work }; }
}
