import { CilError } from '../binary/error.js';

export const metadataReaderDiagnosticCatalog = Object.freeze({
  MD_READ_CANCELED: 'Physical metadata reading was canceled before returning a reader',
  MD_READ_ROW_LIMIT: 'An explicitly bounded metadata read exceeds its row allocation limit',
});

/** Structural signal admission also accepts browser/worker signals from another realm. */
export function metadataReadSignal(signal) {
  if (signal != null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
    throw new CilError('Metadata signal must expose a boolean aborted property');
  }
  return signal;
}

/** Optional per-read bounds; ordinary callers retain the existing one-million-row limit. */
export class MetadataReadBudget {
  constructor(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new CilError('Invalid metadata reader options');
    }
    this.maxRows = options.maxRows ?? 1_000_000;
    if (!Number.isInteger(this.maxRows) || this.maxRows < 0 || this.maxRows > 1_000_000) {
      throw new CilError('Metadata reader row limit must be an integer from 0 through 1000000');
    }
    this.signal = metadataReadSignal(options.signal);
    this.check();
  }

  check() {
    if (this.signal?.aborted) {
      const error = new CilError('Metadata reading canceled');
      error.code = 'MD_READ_CANCELED';
      throw error;
    }
  }
}
