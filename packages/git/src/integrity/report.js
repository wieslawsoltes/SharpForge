import { GitError, checkLimit } from '../errors.js';

export const IntegrityCategory = Object.freeze({
  MissingObject: 'missing-object', BrokenLink: 'broken-link', HashMismatch: 'hash-mismatch',
  BadTree: 'bad-tree', BadCommit: 'bad-commit', BadTag: 'bad-tag', BadRef: 'bad-ref',
  BadIndex: 'bad-index', BadPack: 'bad-pack', TypeMismatch: 'type-mismatch', Cycle: 'cycle',
  Dangling: 'dangling', Unreachable: 'unreachable', InvalidObject: 'invalid-object'
});

/** Bounded structured diagnostics keep fsck suitable for worker, CLI and UI callers. */
export class IntegrityReport {
  constructor(algorithm, { maxDiagnostics = 1000 } = {}) {
    this.algorithm = algorithm;
    this.maximum = checkLimit(maxDiagnostics, 1_000_000, 'Integrity diagnostic limit');
    this.diagnostics = [];
    this.keys = new Set();
    this.categories = {};
    this.errors = 0;
    this.warnings = 0;
  }

  add(category, message, details = {}, severity = 'error') {
    const key = JSON.stringify([category, details.oid, details.source, details.ref, details.pack]);
    if (this.keys.has(key)) return;
    checkLimit(this.diagnostics.length + 1, this.maximum, 'Integrity diagnostics');
    this.keys.add(key);
    this.diagnostics.push(Object.freeze({
      id: `GIT-FSCK-${category.toUpperCase()}`, category, severity, message, ...details
    }));
    this.categories[category] = (this.categories[category] ?? 0) + 1;
    if (severity === 'error') this.errors++;
    else this.warnings++;
  }

  capture(error, category, details = {}) {
    if (!(error instanceof GitError)) throw error;
    if (['Cancelled', 'Limit', 'Quota', 'Disposed', 'Auth', 'Network'].includes(error.code)) throw error;
    this.add(category, error.message, { ...details, code: error.code });
  }

  finish(statistics) {
    return Object.freeze({
      ok: this.errors === 0, algorithm: this.algorithm, ...statistics,
      errors: this.errors, warnings: this.warnings,
      categories: Object.freeze({ ...this.categories }), diagnostics: Object.freeze([...this.diagnostics])
    });
  }
}
